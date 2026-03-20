import argparse
import json
import shutil
import sqlite3
import sys
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parent.parent
DEFAULT_OUTPUT_DIR = ROOT_DIR / "apps" / "flutter_viewer" / "assets" / "data"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Convert a Note Harbor archive into bundled Flutter viewer assets."
    )
    parser.add_argument(
        "--archive", required=True, help="Path to the exported archive .zip file"
    )
    parser.add_argument(
        "--output",
        default=str(DEFAULT_OUTPUT_DIR),
        help="Output directory for assets/data (default: apps/flutter_viewer/assets/data)",
    )
    return parser.parse_args()


def remove_path_if_exists(target: Path) -> None:
    if target.exists():
        if target.is_dir():
            shutil.rmtree(target)
        else:
            target.unlink()


def is_inside_directory(root: Path, candidate: Path) -> bool:
    try:
        candidate.relative_to(root)
        return True
    except ValueError:
        return False


def extract_archive(zip_path: Path, output_dir: Path) -> None:
    with zipfile.ZipFile(zip_path) as archive:
        for member in archive.infolist():
            destination = (output_dir / member.filename).resolve()
            if not is_inside_directory(output_dir.resolve(), destination):
                raise ValueError("Archive contains invalid file paths.")

        archive.extractall(output_dir)


def find_archive_data_dir(root_dir: Path) -> Path | None:
    for candidate in [root_dir, *root_dir.rglob("*")]:
        if not candidate.is_dir():
            continue
        if (candidate / "banknotes.db").exists() and (candidate / "images").is_dir():
            return candidate
    return None


def parse_json(value, fallback):
    if not value:
        return fallback
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return fallback


def to_display_string(value) -> str:
    return str(value or "").strip()


def sanitize_asset_segment(value: str) -> str:
    return "".join(char if char.isalnum() or char in "._-" else "_" for char in value)


def relative_image_path_from_local_path(local_path: str) -> Path | None:
    normalized = to_display_string(local_path)
    prefix = "/api/images/"
    if not normalized.startswith(prefix):
        return None
    return Path(normalized.replace(prefix, "", 1))


def build_tag_map(connection: sqlite3.Connection) -> dict[int, list[dict[str, object]]]:
    rows = connection.execute(
        """
        SELECT bt.banknote_id, t.id, t.name
        FROM banknote_tags bt
        INNER JOIN tags t ON t.id = bt.tag_id
        ORDER BY t.name COLLATE NOCASE ASC
        """
    ).fetchall()
    tag_map: dict[int, list[dict[str, object]]] = {}
    for banknote_id, tag_id, name in rows:
        tag_map.setdefault(banknote_id, []).append(
            {"id": tag_id, "name": to_display_string(name)}
        )
    return tag_map


def copy_image_into_assets(
    *,
    source_images_dir: Path,
    output_images_dir: Path,
    note_id: int,
    image: dict,
    warnings: list[str],
) -> dict[str, object] | None:
    relative_source_path = relative_image_path_from_local_path(
        image.get("localPath", "")
    )
    if relative_source_path is None:
        warnings.append(
            f"Skipped image with unsupported localPath for note {note_id}: {image.get('localPath', '')}"
        )
        return None

    source_path = source_images_dir / relative_source_path
    if not source_path.exists():
        warnings.append(
            f"Missing image file for note {note_id}: {relative_source_path.as_posix()}"
        )
        return None

    output_relative_path = relative_source_path.with_name(
        f"{sanitize_asset_segment(relative_source_path.stem)}{relative_source_path.suffix.lower()}"
    )
    output_path = output_images_dir / output_relative_path
    output_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source_path, output_path)

    return {
        "type": to_display_string(image.get("type")),
        "variant": to_display_string(image.get("variant")),
        "assetPath": f"assets/data/images/{output_relative_path.as_posix()}",
        "sourceUrl": to_display_string(image.get("sourceUrl")) or None,
    }


def build_dataset(
    *, data_dir: Path, output_dir: Path
) -> tuple[list[dict[str, object]], list[str]]:
    database_path = data_dir / "banknotes.db"
    images_dir = data_dir / "images"
    output_images_dir = output_dir / "images"
    output_images_dir.mkdir(parents=True, exist_ok=True)
    (output_images_dir / ".keep").write_text("", encoding="utf-8")

    connection = sqlite3.connect(database_path)
    warnings: list[str] = []

    try:
        tag_map = build_tag_map(connection)
        rows = connection.execute(
            """
            SELECT
              id,
              display_order,
              denomination,
              issue_date,
              catalog_number,
              grading_company,
              grade,
              watermark,
              serial,
              url,
              notes,
              scraped_data,
              images,
              scrape_status,
              scrape_error,
              created_at,
              updated_at
            FROM banknotes
            ORDER BY display_order ASC, id ASC
            """
        ).fetchall()

        notes = []
        for index, row in enumerate(rows, start=1):
            (
                note_id,
                display_order,
                denomination,
                issue_date,
                catalog_number,
                grading_company,
                grade,
                watermark,
                serial,
                url,
                notes_text,
                scraped_data,
                images,
                scrape_status,
                scrape_error,
                created_at,
                updated_at,
            ) = row

            parsed_images = parse_json(images, [])
            bundled_images = []
            if isinstance(parsed_images, list):
                for image in parsed_images:
                    if not isinstance(image, dict):
                        continue
                    next_image = copy_image_into_assets(
                        source_images_dir=images_dir,
                        output_images_dir=output_images_dir,
                        note_id=note_id,
                        image=image,
                        warnings=warnings,
                    )
                    if next_image is not None:
                        bundled_images.append(next_image)

            notes.append(
                {
                    "id": int(note_id),
                    "displayOrder": int(display_order or index),
                    "denomination": to_display_string(denomination),
                    "issueDate": to_display_string(issue_date),
                    "catalogNumber": to_display_string(catalog_number),
                    "gradingCompany": to_display_string(grading_company),
                    "grade": to_display_string(grade),
                    "watermark": to_display_string(watermark),
                    "serial": to_display_string(serial),
                    "url": to_display_string(url),
                    "notes": to_display_string(notes_text),
                    "scrapeStatus": to_display_string(scrape_status),
                    "scrapeError": to_display_string(scrape_error),
                    "createdAt": to_display_string(created_at),
                    "updatedAt": to_display_string(updated_at),
                    "scrapedData": parse_json(scraped_data, None),
                    "tags": tag_map.get(note_id, []),
                    "images": bundled_images,
                }
            )

        dataset_payload = {
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "noteCount": len(notes),
            "notes": notes,
        }
        (output_dir / "notes.json").write_text(
            f"{json.dumps(dataset_payload, indent=2)}\n", encoding="utf-8"
        )
        return notes, warnings
    finally:
        connection.close()


def main() -> int:
    args = parse_args()
    archive_path = Path(args.archive).resolve()
    output_dir = Path(args.output).resolve()

    if not archive_path.exists():
        raise FileNotFoundError(f"Archive not found: {archive_path}")

    with tempfile.TemporaryDirectory(prefix="noteharbor-flutter-viewer-") as temp_dir:
        temp_root = Path(temp_dir)
        extract_archive(archive_path, temp_root)
        data_dir = find_archive_data_dir(temp_root)
        if data_dir is None:
            raise ValueError(
                "Archive must contain a banknotes.db file and an images directory."
            )

        remove_path_if_exists(output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)
        notes, warnings = build_dataset(data_dir=data_dir, output_dir=output_dir)

        print(f"Built Flutter viewer dataset with {len(notes)} notes.")
        print(f"Output: {output_dir}")
        if warnings:
            print("Warnings:")
            for warning in warnings:
                print(f"- {warning}")

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
