"""Normalize the supplied scene and prepare matching render and collision assets."""
import sys,json,struct,io,copy
from pathlib import Path
import numpy as np
from gltf_input import j,buf,world
# Source units are centimetres. Ground at 170cm; center the 64m-long yard.
scale=.01;offset=np.array([0,-1.7,5.0]);collisions=[];metadata=[]
for index,name,primitives,mn,mx in world:
 if 'Human' in name:continue
 points=[];faces=[];at=0
 for pos,ix in primitives:
  points.append(pos*scale+offset);faces.append(ix+at);at+=len(pos)
 points=np.concatenate(points);faces=np.concatenate(faces)
 unique,inverse=np.unique(np.round(points,4),axis=0,return_inverse=True);faces=inverse[faces]
 triangles=faces.reshape(-1,3);valid=np.linalg.norm(np.cross(unique[triangles[:,1]]-unique[triangles[:,0]],unique[triangles[:,2]]-unique[triangles[:,0]]),axis=1)>1e-7;triangles=triangles[valid]
 lo=unique.min(0);hi=unique.max(0)
 collisions.append(dict(p=((lo+hi)/2).tolist(),s=np.maximum(hi-lo,.002).tolist(),kind='model',solid=True,mesh=dict(vertices=unique.ravel().tolist(),indices=triangles.ravel().tolist()),name=name))
 metadata.append(dict(name=name,min=lo.tolist(),max=hi.tolist()))
Path('src/generated').mkdir(exist_ok=True)
Path('src/generated/rust-collision.json').write_text(json.dumps(collisions,separators=(',',':')))
Path('src/generated/rust-metadata.json').write_text(json.dumps(metadata,separators=(',',':')))
print('Geometry MB',Path('src/generated/rust-collision.json').stat().st_size/1e6,'triangles',sum(len(c['mesh']['indices'])//3 for c in collisions))
