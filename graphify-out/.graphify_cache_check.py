import json
from graphify.cache import check_semantic_cache
from pathlib import Path

incremental = json.loads(Path('graphify-out/.graphify_incremental.json').read_text(encoding="utf-8"))
non_code = (
    incremental.get('new_files', {}).get('document', []) +
    incremental.get('new_files', {}).get('image', [])
)
cached_nodes, cached_edges, cached_hyperedges, uncached = check_semantic_cache(non_code)
if cached_nodes or cached_edges:
    Path('graphify-out/.graphify_cached.json').write_text(json.dumps({'nodes': cached_nodes, 'edges': cached_edges, 'hyperedges': cached_hyperedges}, ensure_ascii=False), encoding="utf-8")
Path('graphify-out/.graphify_uncached.txt').write_text('\n'.join(uncached), encoding="utf-8")
print(f'Cache: {len(non_code)-len(uncached)} hit, {len(uncached)} need extraction')
