import open3d as o3d
import numpy as np
import os

def generate_diff_snapshots(mesh: o3d.geometry.TriangleMesh, base_path: str) -> list[str]:
    """Render 4 orthogonal views of a mesh (diff heatmap) and save to PNG.
    Returns the list of paths to the generated images.
    """
    img_paths = []
    
    # Headless rendering setup
    render = o3d.visualization.rendering.OffscreenRenderer(800, 800)
    
    mat = o3d.visualization.rendering.MaterialRecord()
    mat.shader = "defaultUnlit"
    
    render.scene.add_geometry("mesh", mesh, mat)
    
    # Calculate bounding box and center
    bbox = mesh.get_axis_aligned_bounding_box()
    center = mesh.get_center()
    extent = bbox.get_extent()
    max_extent = np.max(extent)
    
    # Views: Top, Front, Left, Right
    views = {
        "top":   {"eye": center + np.array([0, 0, max_extent * 2]), "up": np.array([0, 1, 0])},
        "front": {"eye": center + np.array([0, max_extent * 2, 0]), "up": np.array([0, 0, 1])},
        "left":  {"eye": center + np.array([-max_extent * 2, 0, 0]), "up": np.array([0, 0, 1])},
        "right": {"eye": center + np.array([max_extent * 2, 0, 0]), "up": np.array([0, 0, 1])},
    }
    
    for view_name, params in views.items():
        render.setup_camera(60.0, center, params["eye"], params["up"])
        img = render.render_to_image()
        
        path = f"{base_path}_{view_name}.png"
        o3d.io.write_image(path, img)
        img_paths.append(path)
        
    return img_paths
