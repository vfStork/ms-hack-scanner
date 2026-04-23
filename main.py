"""Digital Twin Scanner — CLI entrypoint."""

import argparse
import sys
import json


def cmd_upload(args):
    from pipeline.ingest import load_scan
    from registry.store import register_twin

    twin = register_twin(name=args.name, raw_ply_path=args.file)
    print(f"Registered twin: {twin.id} ({twin.name})")
    print(f"  Version 1 stored at: {twin.versions[0].raw_ply}")


def cmd_rescan(args):
    from registry.store import add_version

    twin = add_version(twin_id=args.twin_id, raw_ply_path=args.file)
    v = twin.versions[-1]
    print(f"Added version {v.version} to twin {twin.id}")


def cmd_clean(args):
    from pipeline.ingest import load_scan
    from pipeline.clean import clean_mesh
    from registry.store import get_twin, mark_cleaned

    twin = get_twin(args.twin_id)
    version = args.version or twin.versions[-1].version
    v = next((v for v in twin.versions if v.version == version), None)
    if v is None:
        print(f"Version {version} not found"); sys.exit(1)
    if v.is_cleaned:
        print(f"Version {version} already cleaned"); return

    print(f"Cleaning v{version}…")
    raw_mesh = load_scan(v.raw_ply)
    cleaned = clean_mesh(raw_mesh)
    mark_cleaned(args.twin_id, version, cleaned)
    print("Done")


def cmd_crop(args):
    from pipeline.ingest import load_scan
    from pipeline.crop import crop_by_plane, crop_by_bbox
    from registry.store import get_twin, mark_cropped

    twin = get_twin(args.twin_id)
    version = args.version or twin.versions[-1].version
    v = next((v for v in twin.versions if v.version == version), None)
    if v is None:
        print(f"Version {version} not found"); sys.exit(1)

    # Prefer cleaned mesh; fall back to raw
    source_path = v.clean_ply if v.is_cleaned else v.raw_ply
    print(f"Loading v{version} mesh from {source_path}…")
    mesh = load_scan(source_path)

    def _parse_vec(s, name):
        try:
            parts = [float(x) for x in s.split(",")]
            if len(parts) != 3:
                raise ValueError
            return tuple(parts)
        except ValueError:
            print(f"--{name} must be three comma-separated floats, e.g. 0,0,1")
            sys.exit(1)

    if args.mode == "plane":
        if not args.point or not args.normal:
            print("--mode plane requires --point and --normal"); sys.exit(1)
        point = _parse_vec(args.point, "point")
        normal = _parse_vec(args.normal, "normal")
        print(f"Cropping by plane: point={point}, normal={normal}…")
        cropped = crop_by_plane(mesh, point, normal)
    elif args.mode == "bbox":
        if not args.min_bound or not args.max_bound:
            print("--mode bbox requires --min-bound and --max-bound"); sys.exit(1)
        min_b = _parse_vec(args.min_bound, "min-bound")
        max_b = _parse_vec(args.max_bound, "max-bound")
        print(f"Cropping by bbox: min={min_b}, max={max_b}…")
        cropped = crop_by_bbox(mesh, min_b, max_b)
    else:
        print(f"Unknown mode: {args.mode}. Use 'plane' or 'bbox'"); sys.exit(1)

    mark_cropped(args.twin_id, version, cropped)
    print(f"Done — cropped mesh saved for v{version}")


def cmd_compare(args):
    from pipeline.ingest import load_scan
    from pipeline.diff import compute_diff, export_diff_glb
    from ai.describe import describe_changes
    from registry.store import get_twin, add_changelog, _twin_dir

    twin = get_twin(args.twin_id)
    va = next((v for v in twin.versions if v.version == args.v1), None)
    vb = next((v for v in twin.versions if v.version == args.v2), None)
    if va is None or vb is None:
        print("Version not found"); sys.exit(1)

    mesh_a = load_scan(va.clean_ply if va.is_cleaned else va.raw_ply)
    mesh_b = load_scan(vb.clean_ply if vb.is_cleaned else vb.raw_ply)

    print(f"Computing diff v{args.v1} ↔ v{args.v2}…")
    diff = compute_diff(mesh_a, mesh_b)

    heatmap_path = str(_twin_dir(args.twin_id) / f"diff_v{args.v1}_v{args.v2}.glb")
    _, heatmap_mesh = export_diff_glb(mesh_a, diff.per_vertex_distances, heatmap_path)

    base_img_path = heatmap_path.replace(".glb", "")
    from pipeline.render import generate_diff_snapshots
    img_paths = generate_diff_snapshots(heatmap_mesh, base_img_path)

    print("Generating AI description…")
    description = describe_changes(diff, twin.metadata, img_paths)

    add_changelog(args.twin_id, args.v1, args.v2, description, diff.to_dict(), heatmap_path)

    print(f"\nDiff stats: {json.dumps(diff.to_dict(), indent=2)}")
    print(f"\nDescription: {description}")


def cmd_enrich(args):
    from pipeline.ingest import load_scan
    from ai.enrich import enrich_twin
    from registry.store import get_twin, update_metadata

    twin = get_twin(args.twin_id)
    latest = twin.latest_version()
    if latest is None:
        print("No versions found"); sys.exit(1)

    ply_path = latest.clean_ply if latest.is_cleaned else latest.raw_ply
    mesh = load_scan(ply_path)
    print("Running AI enrichment…")
    metadata = enrich_twin(mesh)
    update_metadata(args.twin_id, metadata)
    print(json.dumps(metadata, indent=2))


def cmd_list(args):
    from registry.store import list_twins

    twins = list_twins()
    if not twins:
        print("No twins registered."); return
    for t in twins:
        latest = t.latest_version()
        cleaned = "✓" if latest and latest.is_cleaned else "✗"
        print(f"  {t.id[:8]}  {t.name:<20}  v{len(t.versions)}  clean={cleaned}")


def cmd_show(args):
    from registry.store import get_twin

    twin = get_twin(args.twin_id)
    print(json.dumps(twin.to_dict(), indent=2))


def cmd_serve(args):
    import uvicorn
    print(f"Starting server on http://0.0.0.0:{args.port}")
    uvicorn.run("api.server:app", host="0.0.0.0", port=args.port, reload=args.reload)


def main():
    parser = argparse.ArgumentParser(description="Digital Twin Scanner")
    sub = parser.add_subparsers(dest="command")

    # upload
    p = sub.add_parser("upload", help="Upload a raw scan and register a new twin")
    p.add_argument("file", help="Path to .ply/.obj/.stl file")
    p.add_argument("--name", default="Untitled", help="Twin name")

    # rescan
    p = sub.add_parser("rescan", help="Add a new scan version to an existing twin")
    p.add_argument("twin_id")
    p.add_argument("file", help="Path to .ply/.obj/.stl file")

    # clean
    p = sub.add_parser("clean", help="Clean a specific version (on demand)")
    p.add_argument("twin_id")
    p.add_argument("--version", type=int, default=None, help="Version number (default: latest)")

    # crop
    p = sub.add_parser("crop", help="Crop a mesh by plane or bounding box")
    p.add_argument("twin_id")
    p.add_argument("--version", type=int, default=None, help="Version number (default: latest)")
    p.add_argument("--mode", choices=["plane", "bbox"], required=True,
                   help="Crop strategy: 'plane' or 'bbox'")
    p.add_argument("--point", metavar="x,y,z",
                   help="[plane] A point on the cutting plane")
    p.add_argument("--normal", metavar="nx,ny,nz",
                   help="[plane] Normal pointing toward the region to KEEP")
    p.add_argument("--min-bound", metavar="x,y,z", dest="min_bound",
                   help="[bbox] Minimum corner of the bounding box")
    p.add_argument("--max-bound", metavar="x,y,z", dest="max_bound",
                   help="[bbox] Maximum corner of the bounding box")

    # compare
    p = sub.add_parser("compare", help="Compare two versions of a twin")
    p.add_argument("twin_id")
    p.add_argument("v1", type=int)
    p.add_argument("v2", type=int)

    # enrich
    p = sub.add_parser("enrich", help="Run AI enrichment on a twin")
    p.add_argument("twin_id")

    # list
    sub.add_parser("list", help="List all registered twins")

    # show
    p = sub.add_parser("show", help="Show details of a twin")
    p.add_argument("twin_id")

    # serve
    p = sub.add_parser("serve", help="Start the web server")
    p.add_argument("--port", type=int, default=8000)
    p.add_argument("--reload", action="store_true")

    args = parser.parse_args()

    commands = {
        "upload": cmd_upload,
        "rescan": cmd_rescan,
        "clean": cmd_clean,
        "crop": cmd_crop,
        "compare": cmd_compare,
        "enrich": cmd_enrich,
        "list": cmd_list,
        "show": cmd_show,
        "serve": cmd_serve,
    }

    if args.command in commands:
        commands[args.command](args)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()