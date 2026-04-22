from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional


@dataclass
class TwinVersion:
    version: int
    uploaded_at: str  # ISO format
    raw_ply: str
    raw_glb: str
    clean_ply: Optional[str] = None
    clean_glb: Optional[str] = None
    is_cleaned: bool = False

    def to_dict(self) -> dict:
        return {
            "version": self.version,
            "uploaded_at": self.uploaded_at,
            "raw_ply": self.raw_ply,
            "raw_glb": self.raw_glb,
            "clean_ply": self.clean_ply,
            "clean_glb": self.clean_glb,
            "is_cleaned": self.is_cleaned,
        }

    @classmethod
    def from_dict(cls, d: dict) -> TwinVersion:
        return cls(**d)


@dataclass
class ChangeEntry:
    timestamp: str
    version_a: int
    version_b: int
    description: str
    diff_stats: dict = field(default_factory=dict)
    heatmap_glb: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "timestamp": self.timestamp,
            "version_a": self.version_a,
            "version_b": self.version_b,
            "description": self.description,
            "diff_stats": self.diff_stats,
            "heatmap_glb": self.heatmap_glb,
        }

    @classmethod
    def from_dict(cls, d: dict) -> ChangeEntry:
        return cls(**d)


@dataclass
class Twin:
    id: str  # UUID string
    name: str
    created: str  # ISO format
    versions: list[TwinVersion] = field(default_factory=list)
    changelog: list[ChangeEntry] = field(default_factory=list)
    metadata: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "created": self.created,
            "versions": [v.to_dict() for v in self.versions],
            "changelog": [c.to_dict() for c in self.changelog],
            "metadata": self.metadata,
        }

    @classmethod
    def from_dict(cls, d: dict) -> Twin:
        return cls(
            id=d["id"],
            name=d["name"],
            created=d["created"],
            versions=[TwinVersion.from_dict(v) for v in d.get("versions", [])],
            changelog=[ChangeEntry.from_dict(c) for c in d.get("changelog", [])],
            metadata=d.get("metadata", {}),
        )

    def latest_version(self) -> Optional[TwinVersion]:
        return self.versions[-1] if self.versions else None
