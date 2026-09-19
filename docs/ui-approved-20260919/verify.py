#!/usr/bin/env python3
"""Verify the frozen UI reference without changing it or the working app."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import sys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--compare-live', action='store_true', help='Also compare the current public files with the frozen reference')
    args = parser.parse_args()
    bundle = Path(__file__).resolve().parent
    reference = bundle / 'reference'
    manifest = json.loads((reference / 'manifest.json').read_text(encoding='utf-8'))
    errors = []

    def check(root, entries, label):
        for entry in entries:
            path = root / entry['path']
            if not path.is_file():
                errors.append(f'{label}: missing {entry["path"]}')
                continue
            data = path.read_bytes()
            if len(data) != entry['bytes'] or hashlib.sha256(data).hexdigest() != entry['sha256']:
                errors.append(f'{label}: changed {entry["path"]}')

    check(reference, manifest['files'], 'reference')
    for entry in manifest['files']:
        path = reference / entry['path']
        if path.suffix not in ('.html', '.css') or not path.is_file():
            continue
        source = path.read_text(encoding='utf-8')
        refs = re.findall(r'(?:src|href)=["\']([^"\']+)', source) if path.suffix == '.html' else re.findall(r'url\(["\']?([^"\')]+)', source)
        for ref in refs:
            if ref.startswith(('http:', 'https:', 'data:', '#')):
                continue
            target = path.parent / ref.split('?')[0].split('#')[0]
            if not target.is_file():
                errors.append(f'dependency: {entry["path"]} -> {ref}')

    evidence = json.loads((bundle / 'evidence' / 'manifest.json').read_text(encoding='utf-8'))
    check(bundle / 'evidence', evidence['files'], 'evidence')
    if args.compare_live:
        check(bundle.parent.parent, manifest['files'], 'live')
    if errors:
        print('\n'.join(errors))
        return 1
    print(f'PASS: {len(manifest["files"])} frozen source/assets files, {len(evidence["files"])} evidence files, and local HTML/CSS dependencies')
    if args.compare_live:
        print('PASS: current public files match the frozen reference')
    return 0


if __name__ == '__main__':
    sys.exit(main())
