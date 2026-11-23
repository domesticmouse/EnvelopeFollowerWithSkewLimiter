#!/usr/bin/env python3
"""
Generate a clean, A3 landscape KiCad 10 schematic (`envelope_follower.kicad_sch`)
from the SKiDL circuit single source of truth (`envelope_follower.py`).

Every component value, footprint, BOM field (`LCSC`, `MPN`, `Manufacturer`,
`JLCPCB_Class`, `Silkscreen`, `Notes`), DNP flag, and electrical connection is
derived from `envelope_follower.build_circuit()` and cross-checked against
KiCad 10 symbols in `/Applications/KiCad/KiCad.app/Contents/SharedSupport/symbols`.
"""

import builtins
import datetime
import itertools
import math
import os
import pathlib
import uuid

import envelope_follower

# ---------------------------------------------------------------------------
# Constants & KiCad Paths
# ---------------------------------------------------------------------------
KICAD_SYMBOL_DIR = pathlib.Path(
    os.environ.get(
        "KICAD10_SYMBOL_DIR",
        "/Applications/KiCad/KiCad.app/Contents/SharedSupport/symbols",
    )
)
PROJECT_NAME = ""
UUID_NS = uuid.UUID("7026fcc6-e1a0-409e-aaf4-6a17ea82654f")


# ---------------------------------------------------------------------------
# Quote-Preserving S-Expression Parser & Symbol Flattener
# ---------------------------------------------------------------------------
class Quoted(str):
    """String atom serialized with surrounding double quotes."""


def parse_sexpr(text: str) -> list:
    """Parse a KiCad S-expression document while preserving string quoting."""
    tokens = []
    i = 0
    n = len(text)
    while i < n:
        ch = text[i]
        if ch.isspace():
            i += 1
        elif ch in ("(", ")"):
            tokens.append(ch)
            i += 1
        elif ch == '"':
            i += 1
            buf = []
            while i < n:
                c = text[i]
                if c == "\\":
                    i += 1
                    if i < n:
                        esc = text[i]
                        buf.append({"n": "\n", "r": "\r", "t": "\t"}.get(esc, esc))
                        i += 1
                elif c == '"':
                    i += 1
                    break
                else:
                    buf.append(c)
                    i += 1
            tokens.append(Quoted("".join(buf)))
        else:
            j = i
            while j < n and not text[j].isspace() and text[j] not in ("(", ")"):
                j += 1
            tokens.append(text[i:j])
            i = j

    stack: list[list] = [[]]
    for tok in tokens:
        if tok == "(":
            lst: list = []
            stack[-1].append(lst)
            stack.append(lst)
        elif tok == ")":
            stack.pop()
        else:
            stack[-1].append(tok)
    return stack[0][0]


def _clone(node):
    """Deep-copy a parsed S-expression tree while preserving Quoted subclasses."""
    if isinstance(node, list):
        return [_clone(item) for item in node]
    return node


def dump_sexpr(node, indent: int = 0) -> str:
    """Serialize a parsed S-expression tree with readable indentation."""
    if isinstance(node, Quoted):
        escaped = (
            str(node).replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")
        )
        return f'"{escaped}"'
    if not isinstance(node, list):
        return str(node)
    if not node:
        return "()"
    if all(not isinstance(item, list) for item in node):
        return "(" + " ".join(dump_sexpr(item) for item in node) + ")"

    head = [dump_sexpr(node[0])]
    rest = []
    for item in node[1:]:
        if isinstance(item, list):
            rest.append("\n" + "  " * (indent + 1) + dump_sexpr(item, indent + 1))
        else:
            head.append(dump_sexpr(item))
    return "(" + " ".join(head) + "".join(rest) + ")"


class SymbolLibraryCache:
    """Load KiCad 10 symbols, flatten `(extends ...)`, and cache pin positions."""

    def __init__(self, sym_dir: pathlib.Path = KICAD_SYMBOL_DIR):
        self.sym_dir = sym_dir
        self._raw_libs: dict[str, dict[str, list]] = {}
        self.flattened: dict[str, list] = {}
        self.pins_by_unit: dict[str, dict[int, dict[str, tuple[float, float]]]] = {}

    def _get_lib_syms(self, lib_name: str) -> dict[str, list]:
        if lib_name not in self._raw_libs:
            path = self.sym_dir / f"{lib_name}.kicad_sym"
            tree = parse_sexpr(path.read_text(encoding="utf-8"))
            self._raw_libs[lib_name] = {
                str(item[1]): item
                for item in tree
                if isinstance(item, list) and len(item) > 1 and item[0] == "symbol"
            }
        return self._raw_libs[lib_name]

    def load(self, lib_id: str) -> list:
        """Load and flatten `lib:sym_name`, recording per-unit pin positions."""
        if lib_id in self.flattened:
            return self.flattened[lib_id]

        lib_name, sym_name = lib_id.split(":", 1)
        syms = self._get_lib_syms(lib_name)

        def _flatten(target_name: str) -> list:
            sym = syms[target_name]
            ext = next(
                (
                    str(item[1])
                    for item in sym[2:]
                    if isinstance(item, list) and item[0] == "extends"
                ),
                None,
            )
            if not ext:
                return _clone(sym)

            parent = _flatten(ext)
            child_props = {
                str(item[1]): _clone(item)
                for item in sym[2:]
                if isinstance(item, list) and item[0] == "property"
            }
            c_flags = {
                item[0]: _clone(item)
                for item in sym[2:]
                if isinstance(item, list)
                and item[0] not in ("extends", "property", "symbol")
            }
            p_flags = [
                _clone(item)
                for item in parent[2:]
                if isinstance(item, list)
                and item[0] not in ("extends", "property", "symbol")
            ]

            merged: list = ["symbol", Quoted(target_name)]
            seen_flags = set()
            for item in p_flags:
                tag = item[0]
                seen_flags.add(tag)
                merged.append(c_flags.get(tag, item))
            for tag, item in c_flags.items():
                if tag not in seen_flags:
                    merged.append(item)

            seen_props = set()
            for item in parent[2:]:
                if isinstance(item, list) and item[0] == "property":
                    pname = str(item[1])
                    seen_props.add(pname)
                    merged.append(child_props.get(pname, _clone(item)))
            for item in sym[2:]:
                if isinstance(item, list) and item[0] == "property":
                    pname = str(item[1])
                    if pname not in seen_props:
                        merged.append(_clone(item))

            for item in parent[2:]:
                if isinstance(item, list) and item[0] == "symbol":
                    sub = _clone(item)
                    sub[1] = Quoted(
                        str(sub[1]).replace(f"{ext}_", f"{target_name}_", 1)
                    )
                    merged.append(sub)
            return merged

        flat = _flatten(sym_name)
        flat[1] = Quoted(lib_id)

        # Hide default pin numbers on power symbols cleanly while keeping pin info
        unit_pins: dict[int, dict[str, tuple[float, float]]] = {}
        for sub in flat[2:]:
            if isinstance(sub, list) and sub[0] == "symbol":
                parts = str(sub[1]).rsplit("_", 2)
                u_num = int(parts[1]) if len(parts) == 3 and parts[1].isdigit() else 0
                for item in sub[2:]:
                    if isinstance(item, list) and item[0] == "pin":
                        at = next(
                            x for x in item if isinstance(x, list) and x[0] == "at"
                        )
                        num = next(
                            x for x in item if isinstance(x, list) and x[0] == "number"
                        )
                        unit_pins.setdefault(u_num, {})[str(num[1])] = (
                            float(at[1]),
                            float(at[2]),
                        )

        self.flattened[lib_id] = flat
        self.pins_by_unit[lib_id] = unit_pins
        return flat

    def pin_pos(
        self,
        lib_id: str,
        pin_num: str | int,
        sx: float,
        sy: float,
        *,
        unit: int = 1,
        rot: float = 0.0,
        mirror: str | None = None,
    ) -> tuple[float, float]:
        """Compute exact schematic (x, y) coordinates of a placed symbol's pin."""
        self.load(lib_id)
        unit_map = self.pins_by_unit[lib_id]
        pin_key = str(pin_num)
        if unit in unit_map and pin_key in unit_map[unit]:
            px, py = unit_map[unit][pin_key]
        elif 0 in unit_map and pin_key in unit_map[0]:
            px, py = unit_map[0][pin_key]
        else:
            raise KeyError(f"Pin {pin_key} missing in {lib_id} unit {unit}")

        if mirror == "x":
            py = -py
        elif mirror == "y":
            px = -px
        rad = math.radians(rot)
        rx = px * math.cos(rad) - py * math.sin(rad)
        ry = px * math.sin(rad) + py * math.cos(rad)
        return round(sx + rx, 4), round(sy - ry, 4)

    def unit_pin_numbers(self, lib_id: str, unit: int = 1) -> list[str]:
        """Return ordered pin numbers belonging to `unit` (plus unit 0 shared)."""
        self.load(lib_id)
        unit_map = self.pins_by_unit[lib_id]
        pins = list(unit_map.get(0, {}).keys()) + list(unit_map.get(unit, {}).keys())
        return pins


# ---------------------------------------------------------------------------
# Schematic Builder
# ---------------------------------------------------------------------------
def _det_uuid(key: str) -> str:
    return str(uuid.uuid5(UUID_NS, key))


def _fmt_num(val: float) -> str:
    rounded = round(val, 4)
    if abs(rounded - round(rounded)) < 1e-6:
        return str(round(rounded))
    return f"{rounded:.4f}".rstrip("0").rstrip(".")


class SchematicBuilder:
    """Builds a KiCad 10 `.kicad_sch` file backed by SKiDL parts metadata."""

    def __init__(self, parts_by_ref: dict, sym_cache: SymbolLibraryCache):
        self.parts_by_ref = parts_by_ref
        self.sym_cache = sym_cache
        self.root_uuid = _det_uuid("root_schematic_a3")
        self.used_lib_ids: list[str] = []
        self.symbols: list[list] = []
        self.wires: list[tuple[tuple[float, float], tuple[float, float]]] = []
        self.labels: list[list] = []
        self.no_connects: list[list] = []
        self.shapes: list[list] = []
        self.texts: list[list] = []
        self._pwr_idx = 0
        self._flg_idx = 0
        self._placed_part_pins: dict[
            tuple[str, int], tuple[float, float, float, str | None]
        ] = {}

    def _track_lib(self, lib_id: str) -> None:
        self.sym_cache.load(lib_id)
        if lib_id not in self.used_lib_ids:
            self.used_lib_ids.append(lib_id)

    def _make_prop(
        self,
        name: str,
        value: str,
        x: float,
        y: float,
        *,
        angle: float = 0.0,
        size: float = 1.27,
        justify: str | None = None,
        hide: bool = False,
    ) -> list:
        effects: list = ["effects", ["font", ["size", size, size]]]
        if justify and justify != "center":
            effects.append(["justify", justify])
        if hide:
            effects.append(["hide", "yes"])
        return [
            "property",
            Quoted(name),
            Quoted(value),
            ["at", _fmt_num(x), _fmt_num(y), _fmt_num(angle)],
            effects,
        ]

    def _text_transform(
        self,
        rot: float,
        mirror: str | None,
        justify: str | None,
    ) -> tuple[float, str | None]:
        """Compute property angle & justification so text renders horizontal."""
        r = round(rot) % 360
        if r == 0:
            angle, flip_h = 0.0, (mirror == "y")
        elif r == 90:
            angle, flip_h = 270.0, (mirror == "y")
        elif r == 180:
            angle, flip_h = 0.0, (mirror != "y")
        elif r == 270:
            angle, flip_h = 90.0, (mirror == "y")
        else:
            angle, flip_h = float((-r) % 360), (mirror == "y")

        if flip_h and justify in ("left", "right"):
            justify = "right" if justify == "left" else "left"
        return angle, justify

    def place_part(
        self,
        ref: str,
        x: float,
        y: float,
        *,
        unit: int = 1,
        rot: float = 0.0,
        mirror: str | None = None,
        ref_offset: tuple[float, float] = (0.0, -3.81),
        val_offset: tuple[float, float] = (0.0, 3.81),
        ref_justify: str | None = None,
        val_justify: str | None = None,
        show_ref: bool = True,
        show_val: bool = True,
        text_size: float = 1.15,
    ) -> dict[str, tuple[float, float]]:
        """Place a part (or unit of a multi-unit IC) using SKiDL metadata."""
        part = self.parts_by_ref[ref]
        lib_file = getattr(getattr(part, "lib", ""), "filename", "Device")
        lib_name = pathlib.Path(lib_file).stem if lib_file else "Device"
        lib_id = f"{lib_name}:{part.name}"
        self._track_lib(lib_id)

        self._placed_part_pins[(ref, unit)] = (x, y, rot, mirror)
        dnp_flag = "yes" if getattr(part, "dnp", False) else "no"
        in_bom = "no" if getattr(part, "exclude_from_bom", False) else "yes"
        inst_seed = f"part:{ref}:unit{unit}"

        sym: list = [
            "symbol",
            ["lib_id", Quoted(lib_id)],
            ["at", _fmt_num(x), _fmt_num(y), _fmt_num(rot)],
        ]
        if mirror:
            sym.append(["mirror", mirror])
        sym.extend(
            [
                ["unit", unit],
                ["exclude_from_sim", "no"],
                ["in_bom", in_bom],
                ["on_board", "yes"],
                ["dnp", dnp_flag],
                ["fields_autoplaced", "no"],
                ["uuid", Quoted(_det_uuid(inst_seed))],
            ]
        )

        rx, ry = x + ref_offset[0], y + ref_offset[1]
        vx, vy = x + val_offset[0], y + val_offset[1]
        ref_ang, ref_just = self._text_transform(rot, mirror, ref_justify)
        val_ang, val_just = self._text_transform(rot, mirror, val_justify)
        sym.append(
            self._make_prop(
                "Reference",
                ref,
                rx,
                ry,
                angle=ref_ang,
                size=text_size,
                justify=ref_just,
                hide=not show_ref,
            )
        )
        sym.append(
            self._make_prop(
                "Value",
                part.value_to_str(),
                vx,
                vy,
                angle=val_ang,
                size=text_size,
                justify=val_just,
                hide=not show_val,
            )
        )
        sym.append(
            self._make_prop(
                "Footprint", getattr(part, "footprint", ""), x, y, hide=True
            )
        )
        sym.append(
            self._make_prop(
                "Datasheet", getattr(part, "datasheet", "") or "~", x, y, hide=True
            )
        )
        desc = getattr(part, "description", "")
        if desc:
            sym.append(self._make_prop("Description", desc, x, y, hide=True))

        for fname, fval in part.fields.items():
            if fname.lower() in (
                "reference",
                "value",
                "footprint",
                "datasheet",
                "description",
            ):
                continue
            if fval and str(fval).strip():
                sym.append(self._make_prop(fname, str(fval), x, y, hide=True))

        pin_coords: dict[str, tuple[float, float]] = {}
        for pnum in self.sym_cache.unit_pin_numbers(lib_id, unit):
            sym.append(
                [
                    "pin",
                    Quoted(pnum),
                    ["uuid", Quoted(_det_uuid(f"{inst_seed}:pin:{pnum}"))],
                ]
            )
            pin_coords[pnum] = self.sym_cache.pin_pos(
                lib_id, pnum, x, y, unit=unit, rot=rot, mirror=mirror
            )

        sym.append(
            [
                "instances",
                [
                    "project",
                    Quoted(PROJECT_NAME),
                    [
                        "path",
                        Quoted(f"/{self.root_uuid}"),
                        ["reference", Quoted(ref)],
                        ["unit", unit],
                    ],
                ],
            ]
        )
        self.symbols.append(sym)
        return pin_coords

    def place_power(
        self,
        net_name: str,
        x: float,
        y: float,
        *,
        rot: float = 0.0,
        val_offset: tuple[float, float] | None = None,
    ) -> tuple[float, float]:
        """Place a global KiCad power symbol (`+12V`, `-12V`, `GND`) or `PWR_FLAG`."""
        lib_id = f"power:{net_name}"
        self._track_lib(lib_id)

        if net_name == "PWR_FLAG":
            self._flg_idx += 1
            ref = f"#FLG{self._flg_idx:03d}"
            show_val = False
        else:
            self._pwr_idx += 1
            ref = f"#PWR{self._pwr_idx:03d}"
            show_val = True

        if val_offset is None:
            if net_name == "GND" or net_name == "-12V" and rot == 180:
                val_offset = (0.0, 3.81)
            elif net_name == "+12V":
                val_offset = (0.0, -3.81)
            else:
                val_offset = (0.0, -3.81)

        val_ang, _ = self._text_transform(rot, None, None)
        seed = f"pwr:{net_name}:{ref}:{x}:{y}"
        sym: list = [
            "symbol",
            ["lib_id", Quoted(lib_id)],
            ["at", _fmt_num(x), _fmt_num(y), _fmt_num(rot)],
            ["unit", 1],
            ["exclude_from_sim", "yes"],
            ["in_bom", "no"],
            ["on_board", "yes"],
            ["dnp", "no"],
            ["fields_autoplaced", "no"],
            ["uuid", Quoted(_det_uuid(seed))],
            self._make_prop("Reference", ref, x, y + 1.27, hide=True),
            self._make_prop(
                "Value",
                net_name,
                x + val_offset[0],
                y + val_offset[1],
                angle=val_ang,
                size=1.15,
                hide=not show_val,
            ),
            self._make_prop("Footprint", "", x, y, hide=True),
            self._make_prop("Datasheet", "", x, y, hide=True),
            ["pin", Quoted("1"), ["uuid", Quoted(_det_uuid(f"{seed}:pin:1"))]],
            [
                "instances",
                [
                    "project",
                    Quoted(PROJECT_NAME),
                    [
                        "path",
                        Quoted(f"/{self.root_uuid}"),
                        ["reference", Quoted(ref)],
                        ["unit", 1],
                    ],
                ],
            ],
        ]
        self.symbols.append(sym)
        return (round(x, 4), round(y, 4))

    def add_wire(self, p1: tuple[float, float], p2: tuple[float, float]) -> None:
        """Add an orthogonal (or straight) wire segment between p1 and p2."""
        x1, y1 = round(p1[0], 4), round(p1[1], 4)
        x2, y2 = round(p2[0], 4), round(p2[1], 4)
        if abs(x1 - x2) < 1e-4 and abs(y1 - y2) < 1e-4:
            return
        self.wires.append(((x1, y1), (x2, y2)))

    def add_polyline(self, *pts: tuple[float, float]) -> None:
        """Emit connected Manhattan wire segments through `pts`."""
        for p1, p2 in itertools.pairwise(pts):
            self.add_wire(p1, p2)

    def add_label(
        self,
        name: str,
        x: float,
        y: float,
        *,
        rot: float = 0.0,
        justify: str = "left",
        size: float = 1.05,
    ) -> None:
        """Add a local net label `(label ...)` cleanly anchored at `(x, y)`."""
        effects: list = ["effects", ["font", ["size", size, size]]]
        if justify and justify != "center":
            effects.append(["justify", justify, "bottom"])
        else:
            effects.append(["justify", "bottom"])
        self.labels.append(
            [
                "label",
                Quoted(name),
                ["at", _fmt_num(x), _fmt_num(y), _fmt_num(rot)],
                ["fields_autoplaced", "yes"],
                effects,
                ["uuid", Quoted(_det_uuid(f"lbl:{name}:{x}:{y}:{len(self.labels)}"))],
            ]
        )

    def add_no_connect(self, pt: tuple[float, float]) -> None:
        """Place a KiCad no-connect `X` marker at `pt`."""
        x, y = round(pt[0], 4), round(pt[1], 4)
        self.no_connects.append(
            [
                "no_connect",
                ["at", _fmt_num(x), _fmt_num(y)],
                ["uuid", Quoted(_det_uuid(f"nc:{x}:{y}"))],
            ]
        )

    def add_section_box(
        self, title: str, x1: float, y1: float, x2: float, y2: float
    ) -> None:
        """Add a subtle dashed section frame and header caption."""
        self.shapes.append(
            [
                "rectangle",
                ["start", _fmt_num(x1), _fmt_num(y1)],
                ["end", _fmt_num(x2), _fmt_num(y2)],
                [
                    "stroke",
                    ["width", "0.2"],
                    ["type", "dash"],
                    ["color", 90, 100, 120, 1],
                ],
                ["fill", ["type", "none"]],
                ["uuid", Quoted(_det_uuid(f"box:{title}:{x1}:{y1}"))],
            ]
        )
        self.texts.append(
            [
                "text",
                Quoted(title),
                ["exclude_from_sim", "no"],
                ["at", _fmt_num(x1 + 2.54), _fmt_num(y1 + 3.81), 0],
                [
                    "effects",
                    ["font", ["size", "1.6", "1.6"], ["bold", "yes"]],
                    ["justify", "left"],
                ],
                ["uuid", Quoted(_det_uuid(f"txt:{title}:{x1}:{y1}"))],
            ]
        )

    def _compute_junctions(self) -> list[tuple[float, float]]:
        """Detect T-junctions and 3+-way wire vertices for explicit `(junction ...)` dots."""
        endpoints: dict[tuple[float, float], int] = {}
        for p1, p2 in self.wires:
            endpoints[p1] = endpoints.get(p1, 0) + 1
            endpoints[p2] = endpoints.get(p2, 0) + 1

        junction_pts: set[tuple[float, float]] = {
            pt for pt, count in endpoints.items() if count >= 3
        }

        # Check every wire endpoint against the strict interior of every wire segment
        all_pts = set(endpoints.keys())
        for px, py in all_pts:
            for (x1, y1), (x2, y2) in self.wires:
                if abs(x1 - x2) < 1e-4 and abs(px - x1) < 1e-4:
                    ymin, ymax = min(y1, y2), max(y1, y2)
                    if ymin + 1e-4 < py < ymax - 1e-4:
                        junction_pts.add((px, py))
                elif abs(y1 - y2) < 1e-4 and abs(py - y1) < 1e-4:
                    xmin, xmax = min(x1, x2), max(x1, x2)
                    if xmin + 1e-4 < px < xmax - 1e-4:
                        junction_pts.add((px, py))

        return sorted(junction_pts)

    def build_sexpr(self) -> list:
        """Assemble the full KiCad 10 schematic S-expression tree."""
        lib_syms = ["lib_symbols"]
        for lib_id in self.used_lib_ids:
            lib_syms.append(self.sym_cache.load(lib_id))

        wire_nodes = [
            [
                "wire",
                [
                    "pts",
                    ["xy", _fmt_num(p1[0]), _fmt_num(p1[1])],
                    ["xy", _fmt_num(p2[0]), _fmt_num(p2[1])],
                ],
                ["stroke", ["width", 0], ["type", "default"]],
                ["uuid", Quoted(_det_uuid(f"wire:{idx}:{p1}:{p2}"))],
            ]
            for idx, (p1, p2) in enumerate(self.wires)
        ]

        junction_nodes = [
            [
                "junction",
                ["at", _fmt_num(jx), _fmt_num(jy)],
                ["diameter", 0],
                ["color", 0, 0, 0, 0],
                ["uuid", Quoted(_det_uuid(f"junc:{jx}:{jy}"))],
            ]
            for jx, jy in self._compute_junctions()
        ]

        today = (
            datetime.datetime.now(tz=datetime.timezone.utc)
            .astimezone()
            .date()
            .isoformat()
        )
        tree: list = [
            "kicad_sch",
            ["version", 20250114],
            ["generator", Quoted("skidl")],
            ["generator_version", Quoted("3.0.0")],
            ["uuid", Quoted(self.root_uuid)],
            ["paper", Quoted("A3")],
            [
                "title_block",
                [
                    "title",
                    Quoted("Envelope Follower with Skew Limiter (6 HP Eurorack)"),
                ],
                ["date", Quoted(today)],
                ["rev", Quoted("1.0")],
                ["company", Quoted("EnvelopeFollowerWithSkewLimiter")],
                [
                    "comment",
                    1,
                    Quoted(
                        "2x TL074HIDR | 50 SMD (3 Extended SKUs) + 18 THT + 12 DNP TPs"
                    ),
                ],
                [
                    "comment",
                    2,
                    Quoted(
                        "Generated from SKiDL circuit definition in envelope_follower.py"
                    ),
                ],
            ],
            lib_syms,
            *self.shapes,
            *self.texts,
            *wire_nodes,
            *junction_nodes,
            *self.no_connects,
            *self.labels,
            *self.symbols,
            ["sheet_instances", ["path", Quoted("/"), ["page", Quoted("1")]]],
        ]
        return tree


# ---------------------------------------------------------------------------
# 9-Section Schematic Layout
# ---------------------------------------------------------------------------
def draw_schematic(parts_by_ref: dict) -> SchematicBuilder:
    """Place and wire all 80 components in 9 clean A3 functional sections."""
    sch = SchematicBuilder(parts_by_ref, SymbolLibraryCache())

    # =========================================================================
    # SECTION 1: INPUT & x2 PREAMP (U1A)
    # =========================================================================
    sch.add_section_box("1. INPUT & x2 PREAMP (U1A)", 15.24, 15.24, 134.62, 109.22)

    j1 = sch.place_part(
        "J1",
        24.13,
        50.80,
        mirror="x",
        ref_offset=(-1.27, -7.62),
        val_offset=(-1.27, 7.62),
    )
    gnd_j1 = sch.place_power("GND", 31.75, 60.96)
    sch.add_polyline(j1["TN"], (31.75, j1["TN"][1]), gnd_j1)
    sch.add_polyline(j1["S"], (31.75, j1["S"][1]))

    r3 = sch.place_part(
        "R3",
        39.37,
        60.96,
        ref_offset=(2.54, -1.27),
        val_offset=(2.54, 1.27),
        ref_justify="left",
        val_justify="left",
    )
    gnd_r3 = sch.place_power("GND", 39.37, 68.58)
    sch.add_wire(r3["2"], gnd_r3)

    c7 = sch.place_part(
        "C7", 48.26, 50.80, rot=90, ref_offset=(0.0, -4.445), val_offset=(0.0, 4.445)
    )
    sch.add_wire(j1["T"], (39.37, 50.80))
    sch.add_wire((39.37, 50.80), r3["1"])
    sch.add_wire((39.37, 50.80), c7["1"])
    sch.add_label("NET_IN_JACK", 35.56, 50.80, justify="center", size=0.9)

    rv1 = sch.place_part(
        "RV1",
        62.23,
        54.61,
        mirror="x",
        ref_offset=(-4.445, 0.0),
        val_offset=(-4.445, 2.54),
        ref_justify="right",
        val_justify="right",
    )
    sch.add_wire(c7["2"], rv1["3"])
    sch.add_label("NET_IN_AC", 55.88, 50.80, justify="center", size=0.85)
    gnd_rv1 = sch.place_power("GND", 62.23, 63.50)
    sch.add_wire(rv1["1"], gnd_rv1)

    r4 = sch.place_part(
        "R4", 80.01, 54.61, rot=90, ref_offset=(0.0, -3.175), val_offset=(0.0, 3.175)
    )
    sch.add_wire(rv1["2"], r4["1"])
    sch.add_label("NET_GAIN_WIPER", 71.12, 54.61, justify="center", size=0.85)

    r5 = sch.place_part(
        "R5",
        87.63,
        60.96,
        ref_offset=(-2.54, -1.27),
        val_offset=(-2.54, 1.27),
        ref_justify="right",
        val_justify="right",
    )
    gnd_r5 = sch.place_power("GND", 87.63, 68.58, val_offset=(0.0, 3.5))
    sch.add_wire(r5["2"], gnd_r5)

    u1a = sch.place_part(
        "U1",
        104.14,
        57.15,
        unit=1,
        ref_offset=(0.0, -6.35),
        val_offset=(0.0, 6.985),
    )
    sch.add_polyline(r4["2"], (87.63, 54.61), u1a["3"])
    sch.add_wire((87.63, 54.61), r5["1"])
    sch.add_label("NET_U1A_POS", 90.17, 54.61, justify="center", size=0.85)

    # U1A feedback & DC unity capacitor leg
    r6 = sch.place_part(
        "R6", 104.14, 78.74, rot=90, ref_offset=(0.0, -3.175), val_offset=(0.0, 3.175)
    )
    c8 = sch.place_part(
        "C8", 104.14, 90.17, rot=90, ref_offset=(0.0, -3.81), val_offset=(0.0, 3.81)
    )
    r7 = sch.place_part(
        "R7",
        83.82,
        83.82,
        ref_offset=(-2.54, -1.27),
        val_offset=(-2.54, 1.27),
        ref_justify="right",
        val_justify="right",
    )
    c9 = sch.place_part(
        "C9",
        83.82,
        95.25,
        ref_offset=(-2.54, -1.27),
        val_offset=(-2.54, 1.27),
        ref_justify="right",
        val_justify="right",
    )
    gnd_c9 = sch.place_power("GND", 83.82, 102.87)

    sch.add_polyline(u1a["2"], (93.98, 59.69), (93.98, 78.74), r6["1"])
    sch.add_polyline((93.98, 78.74), (93.98, 90.17), c8["1"])
    sch.add_polyline((93.98, 78.74), (83.82, 78.74), r7["1"])
    sch.add_wire(r7["2"], c9["1"])
    sch.add_wire(c9["2"], gnd_c9)
    sch.add_label("NET_U1A_INV", 88.90, 78.74, justify="center", size=0.9)
    sch.add_label("NET_U1A_CG", 83.82, 89.535, justify="left", size=0.9)

    sch.add_polyline(r6["2"], (115.57, 78.74), (115.57, 57.15))
    sch.add_polyline(c8["2"], (115.57, 90.17), (115.57, 78.74))
    sch.add_polyline(u1a["1"], (115.57, 57.15), (140.97, 57.15))
    sch.add_label("NET_PREAMP_OUT", 125.73, 57.15, justify="center")

    # =========================================================================
    # SECTION 2: PRECISION FULL-WAVE RECTIFIER (U1B, U1C, D3)
    # =========================================================================
    sch.add_section_box(
        "2. PRECISION FULL-WAVE RECTIFIER (U1B, U1C, D3)", 137.16, 15.24, 281.94, 109.22
    )

    r8 = sch.place_part(
        "R8", 147.32, 57.15, rot=90, ref_offset=(0.0, -3.175), val_offset=(0.0, 3.175)
    )
    u1b = sch.place_part(
        "U1",
        170.18,
        59.69,
        unit=2,
        mirror="x",
        ref_offset=(0.0, -6.35),
        val_offset=(0.0, 6.985),
    )
    gnd_u1b = sch.place_power("GND", 162.56, 69.85)
    sch.add_wire(u1b["5"], gnd_u1b)
    sch.add_wire((140.97, 57.15), r8["1"])
    sch.add_wire(r8["2"], u1b["6"])
    sch.add_label("NET_U1B_INV", 154.94, 57.15, justify="center", size=0.85)

    # D3 BAT54S & R9 feedback above U1B
    d3 = sch.place_part(
        "D3",
        177.80,
        40.64,
        mirror="y",
        ref_offset=(0.0, -4.445),
        val_offset=(0.0, -6.985),
    )
    r9 = sch.place_part(
        "R9", 177.80, 25.40, rot=90, ref_offset=(0.0, -3.175), val_offset=(0.0, 3.175)
    )
    sch.add_polyline((158.75, 57.15), (158.75, 40.64), d3["2"])
    sch.add_polyline((158.75, 40.64), (158.75, 25.40), r9["1"])
    sch.add_wire(d3["3"], u1b["7"])
    sch.add_label("NET_U1B_OUT", 177.80, 50.80, justify="left")

    r10 = sch.place_part(
        "R10", 205.74, 40.64, rot=90, ref_offset=(0.0, -3.175), val_offset=(0.0, 3.175)
    )
    sch.add_polyline(d3["1"], (191.77, 40.64), r10["1"])
    sch.add_polyline(r9["2"], (191.77, 25.40), (191.77, 40.64))
    sch.add_label("NET_RECT_HALF", 196.85, 40.64, justify="center", size=0.85)

    # Lower feedforward branch (R11 + R12)
    r11 = sch.place_part(
        "R11", 157.48, 86.36, rot=90, ref_offset=(0.0, -3.175), val_offset=(0.0, 3.175)
    )
    r12 = sch.place_part(
        "R12", 180.34, 86.36, rot=90, ref_offset=(0.0, -3.175), val_offset=(0.0, 3.175)
    )
    sch.add_polyline((140.97, 57.15), (140.97, 86.36), r11["1"])
    sch.add_wire(r11["2"], r12["1"])
    sch.add_label("NET_FF_MID", 168.91, 86.36, justify="center")

    # U1C summing stage + R13/R14 feedback above
    u1c = sch.place_part(
        "U1",
        236.22,
        59.69,
        unit=3,
        mirror="x",
        ref_offset=(0.0, -6.35),
        val_offset=(0.0, 6.985),
    )
    gnd_u1c = sch.place_power("GND", 228.60, 69.85)
    sch.add_wire(u1c["10"], gnd_u1c)

    sch.add_polyline(r10["2"], (214.63, 40.64), (214.63, 57.15), u1c["9"])
    sch.add_polyline(r12["2"], (214.63, 86.36), (214.63, 57.15))
    sch.add_label("NET_RECT_SUM", 214.63, 50.80, justify="right")

    r13 = sch.place_part(
        "R13", 228.60, 40.64, rot=90, ref_offset=(0.0, -3.175), val_offset=(0.0, 3.175)
    )
    r14 = sch.place_part(
        "R14", 251.46, 40.64, rot=90, ref_offset=(0.0, -3.175), val_offset=(0.0, 3.175)
    )
    sch.add_polyline((220.98, 57.15), (220.98, 40.64), r13["1"])
    sch.add_wire(r13["2"], r14["1"])
    sch.add_label("NET_FWR_FB_MID", 240.03, 40.64, justify="center", size=0.9)

    sch.add_polyline(r14["2"], (259.08, 40.64), (259.08, 59.69))
    sch.add_polyline(u1c["8"], (259.08, 59.69), (276.86, 59.69))
    sch.add_label("NET_RECT_OUT", 276.86, 59.69, justify="right")

    # =========================================================================
    # SECTION 3: POWER SUPPLY & DECOUPLING (J_PWR, U1E, U2E)
    # =========================================================================
    sch.add_section_box(
        "3. POWER SUPPLY & IC DECOUPLING (J_PWR, U1E, U2E)",
        284.48,
        15.24,
        406.40,
        109.22,
    )

    j_pwr = sch.place_part(
        "J_PWR",
        297.18,
        55.88,
        mirror="x",
        ref_offset=(1.27, -8.89),
        val_offset=(1.27, 8.89),
    )

    # +12V protection & bulk cap
    d1 = sch.place_part(
        "D1", 314.96, 38.10, rot=180, ref_offset=(0.0, -3.175), val_offset=(0.0, 3.175)
    )
    r1 = sch.place_part(
        "R1", 331.47, 38.10, rot=90, ref_offset=(0.0, -3.175), val_offset=(0.0, 3.175)
    )
    sch.add_polyline(j_pwr["9"], (292.10, 38.10), (304.80, 38.10), d1["2"])
    sch.add_wire(j_pwr["10"], (304.80, 38.10))
    sch.add_label("NET_PWR_POS_RAW", 298.45, 38.10, justify="center", size=0.85)
    sch.add_wire(d1["1"], r1["1"])
    sch.add_label("NET_POS_PROT", 323.215, 38.10, justify="center", size=0.85)

    sch.add_wire(r1["2"], (344.17, 38.10))
    sch.place_power("+12V", 344.17, 30.48)
    sch.add_wire((344.17, 38.10), (344.17, 30.48))
    sch.place_power("PWR_FLAG", 350.52, 34.29)
    sch.add_polyline((344.17, 38.10), (350.52, 38.10), (350.52, 34.29))

    c1 = sch.place_part(
        "C1",
        340.36,
        49.53,
        ref_offset=(-3.175, -1.27),
        val_offset=(-3.175, 1.27),
        ref_justify="right",
        val_justify="right",
    )
    sch.add_polyline((340.36, 38.10), c1["1"])
    gnd_c1 = sch.place_power("GND", 340.36, 57.15)
    sch.add_wire(c1["2"], gnd_c1)

    # GND pins 3-8 on J_PWR
    sch.add_polyline(j_pwr["7"], (288.29, j_pwr["7"][1]), (288.29, 66.04))
    sch.add_wire(j_pwr["5"], (288.29, j_pwr["5"][1]))
    sch.add_wire(j_pwr["3"], (288.29, j_pwr["3"][1]))
    gnd_pwr_l = sch.place_power("GND", 288.29, 66.04)
    sch.add_wire((288.29, 58.42), gnd_pwr_l)

    sch.add_polyline(j_pwr["8"], (308.61, j_pwr["8"][1]), (308.61, 58.42))
    sch.add_wire(j_pwr["6"], (308.61, j_pwr["6"][1]))
    sch.add_wire(j_pwr["4"], (308.61, j_pwr["4"][1]))
    gnd_pwr_r = sch.place_power("GND", 313.69, 58.42)
    sch.add_wire((308.61, 58.42), gnd_pwr_r)
    sch.place_power("PWR_FLAG", 318.77, 54.61)
    sch.add_polyline((313.69, 58.42), (318.77, 58.42), (318.77, 54.61))

    # -12V protection & bulk cap (C2.+ -> GND, C2.- -> -12V)
    d2 = sch.place_part(
        "D2", 314.96, 77.47, rot=0, ref_offset=(0.0, -3.175), val_offset=(0.0, 3.175)
    )
    r2 = sch.place_part(
        "R2", 331.47, 77.47, rot=90, ref_offset=(0.0, -3.175), val_offset=(0.0, 3.175)
    )
    sch.add_polyline(j_pwr["1"], (292.10, 77.47), (304.80, 77.47), d2["1"])
    sch.add_wire(j_pwr["2"], (304.80, 77.47))
    sch.add_label("NET_PWR_NEG_RAW", 298.45, 77.47, justify="center", size=0.85)
    sch.add_wire(d2["2"], r2["1"])
    sch.add_label("NET_NEG_PROT", 323.215, 77.47, justify="center", size=0.85)

    sch.add_wire(r2["2"], (350.52, 77.47))
    sch.place_power("-12V", 344.17, 86.36, rot=180)
    sch.add_polyline((344.17, 77.47), (344.17, 86.36))
    sch.place_power("PWR_FLAG", 350.52, 86.36, rot=180)
    sch.add_wire((350.52, 77.47), (350.52, 86.36))

    c2 = sch.place_part(
        "C2",
        350.52,
        67.31,
        ref_offset=(-3.175, -1.27),
        val_offset=(-3.175, 1.27),
        ref_justify="right",
        val_justify="right",
    )
    gnd_c2 = sch.place_power("GND", 350.52, 59.69, rot=180, val_offset=(0.0, -3.81))
    sch.add_wire(c2["1"], gnd_c2)
    sch.add_wire(c2["2"], (350.52, 77.47))

    # U1E & U2E power units + C3-C6 decoupling
    u1e = sch.place_part(
        "U1",
        369.57,
        58.42,
        unit=5,
        ref_offset=(-4.445, -3.81),
        val_offset=(-4.445, -1.27),
        ref_justify="right",
        val_justify="right",
        text_size=1.05,
    )
    sch.place_power("+12V", 367.03, 39.37)
    sch.add_wire(u1e["4"], (367.03, 39.37))
    sch.place_power("-12V", 367.03, 77.47, rot=180)
    sch.add_wire(u1e["11"], (367.03, 77.47))

    c3 = sch.place_part(
        "C3",
        375.92,
        46.99,
        ref_offset=(2.54, -1.27),
        val_offset=(2.54, 1.27),
        ref_justify="left",
        val_justify="left",
        text_size=1.05,
    )
    sch.add_polyline((367.03, 43.18), (375.92, 43.18), c3["1"])

    c4 = sch.place_part(
        "C4",
        375.92,
        69.85,
        rot=180,
        ref_offset=(2.54, -1.27),
        val_offset=(2.54, 1.27),
        ref_justify="left",
        val_justify="left",
        text_size=1.05,
    )
    sch.add_wire(c3["2"], c4["2"])
    gnd_u1_dec = sch.place_power("GND", 379.73, 59.69, val_offset=(0.0, 3.5))
    sch.add_polyline((375.92, 58.42), (379.73, 58.42), gnd_u1_dec)
    sch.add_polyline(c4["1"], (375.92, 73.66), (367.03, 73.66))

    u2e = sch.place_part(
        "U2",
        393.70,
        58.42,
        unit=5,
        ref_offset=(-4.445, -3.81),
        val_offset=(-4.445, -1.27),
        ref_justify="right",
        val_justify="right",
        text_size=1.05,
    )
    sch.place_power("+12V", 391.16, 39.37)
    sch.add_wire(u2e["4"], (391.16, 39.37))
    sch.place_power("-12V", 391.16, 77.47, rot=180)
    sch.add_wire(u2e["11"], (391.16, 77.47))

    c5 = sch.place_part(
        "C5",
        398.78,
        46.99,
        ref_offset=(2.54, -1.27),
        val_offset=(2.54, 1.27),
        ref_justify="left",
        val_justify="left",
        text_size=1.05,
    )
    sch.add_polyline((391.16, 43.18), (398.78, 43.18), c5["1"])

    c6 = sch.place_part(
        "C6",
        398.78,
        69.85,
        rot=180,
        ref_offset=(2.54, -1.27),
        val_offset=(2.54, 1.27),
        ref_justify="left",
        val_justify="left",
        text_size=1.05,
    )
    sch.add_wire(c5["2"], c6["2"])
    gnd_u2_dec = sch.place_power("GND", 402.59, 59.69, val_offset=(0.0, 3.5))
    sch.add_polyline((398.78, 58.42), (402.59, 58.42), gnd_u2_dec)
    sch.add_polyline(c6["1"], (398.78, 73.66), (391.16, 73.66))

    # =========================================================================
    # SECTION 4: SLEW IN & ACTIVE SKEW LIMITER (J2, U1D, U2A)
    # =========================================================================
    sch.add_section_box(
        "4. SLEW IN & ACTIVE SKEW LIMITER (J2, U1D, D4/D5, RV2/RV3, SW2, U2A)",
        15.24,
        114.30,
        198.12,
        205.74,
    )

    r15 = sch.place_part(
        "R15", 30.48, 127.00, rot=90, ref_offset=(0.0, -3.175), val_offset=(0.0, 3.175)
    )
    sch.add_wire((17.78, 127.00), r15["1"])
    sch.add_label("NET_RECT_OUT", 17.78, 127.00, justify="left", size=0.9)

    j2 = sch.place_part(
        "J2",
        31.75,
        139.70,
        mirror="x",
        ref_offset=(-1.27, -7.62),
        val_offset=(-1.27, 7.62),
    )
    sch.add_polyline(r15["2"], (38.10, 127.00), (38.10, j2["TN"][1]), j2["TN"])
    sch.add_label("NET_SLEW_NORM", 38.10, 127.00, justify="left", size=0.9)

    gnd_j2 = sch.place_power("GND", 38.10, 149.86)
    sch.add_polyline(j2["S"], (38.10, j2["S"][1]), gnd_j2)

    r16 = sch.place_part(
        "R16",
        46.99,
        148.59,
        ref_offset=(-2.54, -1.27),
        val_offset=(-2.54, 1.27),
        ref_justify="right",
        val_justify="right",
    )
    gnd_r16 = sch.place_power("GND", 46.99, 156.21)
    sch.add_wire(r16["2"], gnd_r16)

    r17 = sch.place_part(
        "R17", 54.61, 139.70, rot=90, ref_offset=(0.0, -3.175), val_offset=(0.0, 3.175)
    )
    sch.add_wire(j2["T"], (46.99, 139.70))
    sch.add_wire((46.99, 139.70), r16["1"])
    sch.add_wire((46.99, 139.70), r17["1"])
    sch.add_label("NET_SLEW_JACK", 43.815, 139.70, justify="center", size=0.85)

    u1d = sch.place_part(
        "U1", 77.47, 142.24, unit=4, ref_offset=(0.0, -6.35), val_offset=(0.0, 6.985)
    )
    sch.add_wire(r17["2"], u1d["12"])
    sch.add_label("NET_U1D_POS", 62.865, 139.70, justify="center", size=0.85)

    c10 = sch.place_part(
        "C10", 77.47, 160.02, rot=90, ref_offset=(0.0, -3.81), val_offset=(0.0, 3.81)
    )
    sch.add_polyline(u1d["13"], (67.31, 144.78), (67.31, 160.02), c10["1"])
    sch.add_polyline(c10["2"], (88.90, 160.02), (88.90, 142.24))
    sch.add_wire(u1d["14"], (88.90, 142.24))
    sch.add_label("NET_U1D_INV", 67.31, 152.40, justify="right", size=0.9)
    sch.add_label("NET_U1D_OUT", 88.90, 142.24, justify="left", size=0.85)

    # ATK upper branch (D4 -> R19 -> RV2)
    d4 = sch.place_part(
        "D4", 97.79, 132.08, rot=180, ref_offset=(0.0, -3.175), val_offset=(0.0, 3.175)
    )
    r19 = sch.place_part(
        "R19", 114.30, 132.08, rot=90, ref_offset=(0.0, -3.175), val_offset=(0.0, 3.175)
    )
    rv2 = sch.place_part(
        "RV2", 130.81, 132.08, rot=90, ref_offset=(0.0, -7.62), val_offset=(0.0, 3.81)
    )
    sch.add_polyline((88.90, 142.24), (88.90, 132.08), d4["2"])
    sch.add_wire(d4["1"], r19["1"])
    sch.add_label("NET_ATK_DIODE", 106.045, 132.08, justify="center", size=0.85)
    sch.add_wire(r19["2"], rv2["1"])
    sch.add_label("NET_ATK_MIN", 122.555, 132.08, justify="center", size=0.85)
    sch.add_polyline(rv2["2"], (130.81, 125.73), (137.16, 125.73), (137.16, 132.08))
    sch.add_polyline(rv2["3"], (139.70, 132.08), (139.70, 142.24))

    # REL lower branch (D5 -> R20 -> RV3)
    d5 = sch.place_part(
        "D5", 97.79, 152.40, rot=0, ref_offset=(0.0, -3.175), val_offset=(0.0, 3.175)
    )
    r20 = sch.place_part(
        "R20", 114.30, 152.40, rot=90, ref_offset=(0.0, -3.175), val_offset=(0.0, 3.175)
    )
    rv3 = sch.place_part(
        "RV3", 130.81, 152.40, rot=90, ref_offset=(0.0, -7.62), val_offset=(0.0, 3.81)
    )
    sch.add_polyline((88.90, 142.24), (88.90, 152.40), d5["1"])
    sch.add_wire(d5["2"], r20["1"])
    sch.add_label("NET_REL_DIODE", 106.045, 152.40, justify="center", size=0.85)
    sch.add_wire(r20["2"], rv3["1"])
    sch.add_label("NET_REL_MIN", 122.555, 152.40, justify="center", size=0.85)
    sch.add_polyline(rv3["2"], (130.81, 146.05), (137.16, 146.05), (137.16, 152.40))
    sch.add_polyline(rv3["3"], (139.70, 152.40), (139.70, 142.24))

    # Hold caps (C11, SW2, C12, C13) & U2A hold buffer
    c11 = sch.place_part(
        "C11",
        146.05,
        154.94,
        ref_offset=(-2.54, -1.27),
        val_offset=(-2.54, 1.27),
        ref_justify="right",
        val_justify="right",
    )
    gnd_c11 = sch.place_power("GND", 146.05, 162.56)
    sch.add_wire(c11["2"], gnd_c11)

    sw2 = sch.place_part(
        "SW2", 158.75, 160.02, ref_offset=(0.0, -5.08), val_offset=(0.0, 5.08)
    )
    sch.add_no_connect(sw2["1"])

    c12 = sch.place_part(
        "C12",
        168.91,
        173.99,
        ref_offset=(-2.54, -1.27),
        val_offset=(-2.54, 1.27),
        ref_justify="right",
        val_justify="right",
    )
    c13 = sch.place_part(
        "C13",
        179.07,
        173.99,
        ref_offset=(2.54, -1.27),
        val_offset=(2.54, 1.27),
        ref_justify="left",
        val_justify="left",
    )
    gnd_c12 = sch.place_power("GND", 168.91, 181.61)
    gnd_c13 = sch.place_power("GND", 179.07, 181.61)
    sch.add_wire(c12["2"], gnd_c12)
    sch.add_wire(c13["2"], gnd_c13)

    sch.add_polyline(sw2["3"], (168.91, sw2["3"][1]), c12["1"])
    sch.add_polyline((168.91, sw2["3"][1]), (179.07, sw2["3"][1]), c13["1"])
    sch.add_label("NET_SLOW_CAPS", 168.91, sw2["3"][1], justify="left", size=0.9)

    u2a = sch.place_part(
        "U2", 184.15, 144.78, unit=1, ref_offset=(0.0, -6.35), val_offset=(0.0, 6.985)
    )
    sch.add_wire((139.70, 142.24), u2a["3"])
    sch.add_wire((146.05, 142.24), c11["1"])
    sch.add_polyline((152.40, 142.24), (152.40, 160.02), sw2["2"])
    sch.add_label("NET_ENV_CAP", 162.56, 142.24, justify="center")

    # U2A unity feedback + outer feedback R18 back to U1D.-
    r18 = sch.place_part(
        "R18",
        118.11,
        193.04,
        rot=270,
        ref_offset=(0.0, -3.175),
        val_offset=(0.0, 3.175),
    )
    sch.add_polyline(
        u2a["2"], (173.99, 147.32), (173.99, 154.94), (194.31, 154.94), (194.31, 144.78)
    )
    sch.add_polyline(u2a["1"], (194.31, 144.78), (204.47, 144.78))
    sch.add_polyline((194.31, 154.94), (194.31, 193.04), r18["1"])
    sch.add_polyline(r18["2"], (67.31, 193.04), (67.31, 160.02))
    sch.add_label("NET_ENV_BUF", 201.93, 144.78, justify="left", size=0.9)

    # =========================================================================
    # SECTION 5: SMOOTH T-FILTER (SW1)
    # =========================================================================
    sch.add_section_box("5. SMOOTH T-FILTER (SW1)", 200.66, 114.30, 251.46, 205.74)

    r21 = sch.place_part(
        "R21", 217.17, 144.78, rot=90, ref_offset=(0.0, -3.175), val_offset=(0.0, 3.175)
    )
    r22 = sch.place_part(
        "R22", 238.76, 144.78, rot=90, ref_offset=(0.0, -3.175), val_offset=(0.0, 3.175)
    )
    sch.add_wire((204.47, 144.78), r21["1"])
    sch.add_wire(r21["2"], r22["1"])
    sch.add_label("NET_SMOOTH_MID", 227.33, 144.78, justify="center")

    sw1 = sch.place_part(
        "SW1",
        227.33,
        160.02,
        rot=270,
        ref_offset=(5.08, -1.27),
        val_offset=(5.08, 1.27),
        ref_justify="left",
        val_justify="left",
    )
    sch.add_wire((227.33, 144.78), sw1["2"])
    sch.add_no_connect(sw1["1"])

    c14 = sch.place_part(
        "C14",
        224.79,
        173.99,
        ref_offset=(-2.54, -1.27),
        val_offset=(-2.54, 1.27),
        ref_justify="right",
        val_justify="right",
    )
    gnd_c14 = sch.place_power("GND", 224.79, 181.61)
    sch.add_wire(sw1["3"], c14["1"])
    sch.add_wire(c14["2"], gnd_c14)
    sch.add_label("NET_SMOOTH_SW", 224.79, 167.64, justify="right", size=0.9)

    sch.add_wire(r22["2"], (274.32, 144.78))

    # =========================================================================
    # SECTION 6: OUTPUT SUMMER (U2B) & UNITY INVERTER (U2C)
    # =========================================================================
    sch.add_section_box(
        "6. OUTPUT SUMMER (U2B) & UNITY INVERTER (U2C)", 254.00, 114.30, 406.40, 205.74
    )

    r23 = sch.place_part(
        "R23", 271.78, 137.16, rot=90, ref_offset=(0.0, -3.175), val_offset=(0.0, 3.175)
    )
    sch.add_wire((256.54, 137.16), r23["1"])
    sch.add_label("NET_OFF_WIPER", 256.54, 137.16, justify="left", size=0.9)

    u2b = sch.place_part(
        "U2",
        292.10,
        147.32,
        unit=2,
        mirror="x",
        ref_offset=(0.0, -6.35),
        val_offset=(0.0, 6.985),
    )
    gnd_u2b = sch.place_power("GND", 284.48, 157.48)
    sch.add_wire(u2b["5"], gnd_u2b)
    sch.add_wire((274.32, 144.78), u2b["6"])
    sch.add_polyline(r23["2"], (276.86, 137.16), (276.86, 144.78))
    sch.add_label("NET_U2B_INV", 265.43, 144.78, justify="center")

    r24 = sch.place_part(
        "R24", 292.10, 130.81, rot=90, ref_offset=(0.0, -3.175), val_offset=(0.0, 3.175)
    )
    sch.add_polyline((280.67, 144.78), (280.67, 130.81), r24["1"])
    sch.add_polyline(r24["2"], (304.80, 130.81), (304.80, 147.32))
    sch.add_wire(u2b["7"], (313.69, 147.32))
    sch.add_label("NET_INV_AMP", 309.88, 147.32, justify="center")

    # Upper INV_OUT jack branch (R25 -> J4)
    r25 = sch.place_part(
        "R25", 325.12, 134.62, rot=90, ref_offset=(0.0, -3.175), val_offset=(0.0, 3.175)
    )
    j4 = sch.place_part(
        "J4", 355.60, 134.62, rot=180, ref_offset=(1.27, -7.62), val_offset=(1.27, 7.62)
    )
    sch.add_polyline((313.69, 147.32), (313.69, 134.62), r25["1"])
    sch.add_wire(r25["2"], j4["T"])
    sch.add_label("NET_INV_OUT_JACK", 338.455, 134.62, justify="center", size=0.9)
    sch.add_no_connect(j4["TN"])
    gnd_j4 = sch.place_power("GND", 345.44, 144.78)
    sch.add_polyline(j4["S"], (345.44, j4["S"][1]), gnd_j4)

    # Lower unity inverter branch (R30 -> U2C -> R32 -> J3)
    r30 = sch.place_part(
        "R30", 321.31, 170.18, rot=90, ref_offset=(0.0, -3.175), val_offset=(0.0, 3.175)
    )
    sch.add_polyline((313.69, 147.32), (313.69, 170.18), r30["1"])

    u2c = sch.place_part(
        "U2",
        344.17,
        172.72,
        unit=3,
        mirror="x",
        ref_offset=(0.0, -6.35),
        val_offset=(0.0, 6.985),
    )
    gnd_u2c = sch.place_power("GND", 336.55, 182.88)
    sch.add_wire(u2c["10"], gnd_u2c)
    sch.add_wire(r30["2"], u2c["9"])
    sch.add_label("NET_U2C_INV", 329.565, 170.18, justify="center", size=0.85)

    r31 = sch.place_part(
        "R31", 344.17, 156.21, rot=90, ref_offset=(0.0, -3.175), val_offset=(0.0, 3.175)
    )
    sch.add_polyline((332.74, 170.18), (332.74, 156.21), r31["1"])
    sch.add_polyline(r31["2"], (356.87, 156.21), (356.87, 172.72))

    r32 = sch.place_part(
        "R32", 368.30, 172.72, rot=90, ref_offset=(0.0, -3.175), val_offset=(0.0, 3.175)
    )
    j3 = sch.place_part(
        "J3", 394.97, 172.72, rot=180, ref_offset=(1.27, -7.62), val_offset=(1.27, 7.62)
    )
    sch.add_polyline(u2c["8"], (356.87, 172.72), r32["1"])
    sch.add_label("NET_OUT_AMP", 360.68, 172.72, justify="center")
    sch.add_wire(r32["2"], j3["T"])
    sch.add_label("NET_OUT_JACK", 379.73, 172.72, justify="center", size=0.9)
    sch.add_no_connect(j3["TN"])
    gnd_j3 = sch.place_power("GND", 386.08, 182.88)
    sch.add_polyline(j3["S"], (386.08, j3["S"][1]), gnd_j3)

    # =========================================================================
    # SECTION 7: RC-FILTERED OFFSET BIAS (RV4)
    # =========================================================================
    sch.add_section_box(
        "7. RC-FILTERED OFFSET BIAS (RV4)", 15.24, 210.82, 114.30, 281.94
    )

    sch.place_power("+12V", 25.40, 224.79)
    r26 = sch.place_part(
        "R26", 34.29, 231.14, rot=90, ref_offset=(0.0, -3.175), val_offset=(0.0, 3.175)
    )
    c15 = sch.place_part(
        "C15",
        43.18,
        240.03,
        ref_offset=(-2.54, -1.27),
        val_offset=(-2.54, 1.27),
        ref_justify="right",
        val_justify="right",
    )
    r27 = sch.place_part(
        "R27", 58.42, 231.14, rot=90, ref_offset=(0.0, -3.175), val_offset=(0.0, 3.175)
    )
    sch.add_polyline((25.40, 224.79), (25.40, 231.14), r26["1"])
    sch.add_wire(r26["2"], (43.18, 231.14))
    sch.add_wire((43.18, 231.14), c15["1"])
    sch.add_wire((43.18, 231.14), r27["1"])
    sch.add_label("NET_OFF_POS_FILT", 46.355, 231.14, justify="center", size=0.9)

    sch.place_power("-12V", 25.40, 275.59, rot=180)
    r28 = sch.place_part(
        "R28", 34.29, 269.24, rot=90, ref_offset=(0.0, -3.175), val_offset=(0.0, 3.175)
    )
    c16 = sch.place_part(
        "C16",
        43.18,
        260.35,
        rot=180,
        ref_offset=(-2.54, -1.27),
        val_offset=(-2.54, 1.27),
        ref_justify="right",
        val_justify="right",
    )
    r29 = sch.place_part(
        "R29", 58.42, 269.24, rot=90, ref_offset=(0.0, -3.175), val_offset=(0.0, 3.175)
    )
    sch.add_polyline((25.40, 275.59), (25.40, 269.24), r28["1"])
    sch.add_wire(r28["2"], (43.18, 269.24))
    sch.add_wire((43.18, 269.24), c16["1"])
    sch.add_wire(c15["2"], c16["2"])
    gnd_bias_filt = sch.place_power("GND", 48.26, 252.73, val_offset=(0.0, 3.5))
    sch.add_polyline((43.18, 250.19), (48.26, 250.19), gnd_bias_filt)
    sch.add_wire((43.18, 269.24), r29["1"])
    sch.add_label("NET_OFF_NEG_FILT", 46.355, 269.24, justify="center", size=0.9)

    rv4 = sch.place_part(
        "RV4",
        76.20,
        250.19,
        mirror="x",
        ref_offset=(-5.08, -1.27),
        val_offset=(-5.08, 1.27),
        ref_justify="right",
        val_justify="right",
    )
    sch.add_polyline(r27["2"], (76.20, 231.14), rv4["3"])
    sch.add_label("NET_OFF_TOP", 69.215, 231.14, justify="center", size=0.9)
    sch.add_polyline(r29["2"], (76.20, 269.24), rv4["1"])
    sch.add_label("NET_OFF_BOT", 69.215, 269.24, justify="center", size=0.9)
    sch.add_wire(rv4["2"], (99.06, 250.19))
    sch.add_label("NET_OFF_WIPER", 99.06, 250.19, justify="right")

    # =========================================================================
    # SECTION 8: ACTIVE BI-COLOR LED DRIVER (U2D)
    # =========================================================================
    sch.add_section_box(
        "8. ACTIVE BI-COLOR LED DRIVER (U2D)", 116.84, 210.82, 195.58, 281.94
    )

    u2d = sch.place_part(
        "U2", 149.86, 238.76, unit=4, ref_offset=(0.0, -6.35), val_offset=(0.0, 6.985)
    )
    sch.add_wire((124.46, 236.22), u2d["12"])
    sch.add_label("NET_OUT_AMP", 124.46, 236.22, justify="left")

    led1 = sch.place_part(
        "LED1",
        168.91,
        246.38,
        rot=90,
        ref_offset=(6.35, -1.27),
        val_offset=(6.35, 1.27),
        ref_justify="left",
        val_justify="left",
    )
    r33 = sch.place_part(
        "R33",
        168.91,
        265.43,
        ref_offset=(2.54, -1.27),
        val_offset=(2.54, 1.27),
        ref_justify="left",
        val_justify="left",
    )
    gnd_r33 = sch.place_power("GND", 168.91, 274.32)

    sch.add_wire(u2d["14"], led1["1"])
    sch.add_label("NET_LED_DRV", 163.83, 238.76, justify="center")

    sch.add_wire(led1["2"], (168.91, 256.54))
    sch.add_wire((168.91, 256.54), r33["1"])
    sch.add_wire(r33["2"], gnd_r33)
    sch.add_polyline((168.91, 256.54), (139.70, 256.54), (139.70, 241.30), u2d["13"])
    sch.add_label("NET_LED_SENSE", 154.94, 256.54, justify="center")

    # =========================================================================
    # SECTION 9: DNP TEST POINTS (TP1-TP12, B.Cu, RH-5001)
    # =========================================================================
    sch.add_section_box(
        "9. DNP TEST POINTS (TP1-TP12, B.Cu, RH-5001)",
        198.12,
        210.82,
        297.18,
        281.94,
    )

    tp_entries = [
        ("TP1", "GND", True),
        ("TP2", "+12V", True),
        ("TP3", "-12V", True),
        ("TP4", "NET_PREAMP_OUT", False),
        ("TP5", "NET_RECT_OUT", False),
        ("TP6", "NET_ENV_BUF", False),
        ("TP7", "NET_INV_AMP", False),
        ("TP8", "NET_OUT_AMP", False),
        ("TP9", "NET_RECT_HALF", False),
        ("TP10", "NET_U1D_OUT", False),
        ("TP11", "NET_OFF_WIPER", False),
        ("TP12", "GND", True),
    ]

    col_xs = (209.55, 241.30, 273.05)
    row_ys = (227.33, 242.57, 257.81, 273.05)
    for idx, (ref, target, is_pwr) in enumerate(tp_entries):
        col = idx % 3
        row = idx // 3
        tx = col_xs[col]
        ty = row_ys[row]
        tp = sch.place_part(
            ref,
            tx,
            ty,
            rot=90,
            ref_offset=(0.0, -3.81),
            val_offset=(0.0, 3.81),
            text_size=0.95,
        )
        if is_pwr:
            p_end = (tx + 5.08, ty)
            sch.add_wire(tp["1"], p_end)
            if target == "GND":
                sch.place_power("GND", p_end[0], p_end[1] + 2.54, val_offset=(0.0, 3.5))
                sch.add_wire(p_end, (p_end[0], p_end[1] + 2.54))
            elif target == "+12V":
                sch.place_power(
                    "+12V", p_end[0], p_end[1] - 2.54, val_offset=(0.0, -3.5)
                )
                sch.add_wire(p_end, (p_end[0], p_end[1] - 2.54))
            else:
                sch.place_power(
                    "-12V", p_end[0], p_end[1] + 2.54, rot=180, val_offset=(0.0, 3.5)
                )
                sch.add_wire(p_end, (p_end[0], p_end[1] + 2.54))
        else:
            l_end = (tx + 3.81, ty)
            sch.add_wire(tp["1"], l_end)
            sch.add_label(target, l_end[0], l_end[1], justify="left", size=1.0)

    return sch


def main() -> None:
    """Build SKiDL circuit, generate `envelope_follower.kicad_sch`, and validate."""
    envelope_follower.build_circuit()
    parts_by_ref = {p.ref: p for p in builtins.default_circuit.parts}
    sch = draw_schematic(parts_by_ref)
    out_path = pathlib.Path("envelope_follower.kicad_sch")
    out_path.write_text(dump_sexpr(sch.build_sexpr()) + "\n", encoding="utf-8")
    print(
        f"Generated {out_path} ({len(sch.symbols)} symbol instances, {len(sch.wires)} wires)"
    )


if __name__ == "__main__":
    main()
