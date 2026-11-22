import json,struct,sys,numpy as np
f=open(sys.argv[1] if len(sys.argv)>1 else '/home/ubuntu/.codex/attachments/e59563e3-2e57-4ab3-bcc4-44774fde0bc8/RUST.glb','rb');f.read(12);n,_=struct.unpack('<II',f.read(8));j=json.loads(f.read(n));n,_=struct.unpack('<II',f.read(8));buf=f.read(n)
def accessor(i):
 a=j['accessors'][i];v=j['bufferViews'][a['bufferView']];c={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}[a['type']];dt={5126:'<f4',5125:'<u4',5123:'<u2',5121:'u1'}[a['componentType']];return np.ndarray((a['count'],c),np.dtype(dt),buf,v.get('byteOffset',0)+a.get('byteOffset',0),strides=(v.get('byteStride',np.dtype(dt).itemsize*c),np.dtype(dt).itemsize))
def matrix(n):
 if 'matrix'in n:return np.array(n['matrix']).reshape(4,4).T
 x,y,z,w=n.get('rotation',[0,0,0,1]);m=np.eye(4);m[:3,:3]=np.array([[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],[2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],[2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]])@np.diag(n.get('scale',[1,1,1]));m[:3,3]=n.get('translation',[0,0,0]);return m
world=[]
def walk(i,parent=np.eye(4)):
 n=j['nodes'][i];m=parent@matrix(n)
 if 'mesh'in n:
  primitives=[]
  for p in j['meshes'][n['mesh']]['primitives']:
   pos=accessor(p['attributes']['POSITION']);pos=pos@m[:3,:3].T+m[:3,3];ix=accessor(p['indices']).ravel() if 'indices'in p else np.arange(len(pos));primitives.append((pos,ix))
  all=np.concatenate([p[0] for p in primitives]);world.append((i,n.get('name',''),primitives,all.min(0),all.max(0)))
 for c in n.get('children',[]):walk(c,m)
walk(151)
if __name__=='__main__':
 for i,name,p,mn,mx in world: print(i,name, np.round(mn,1).tolist(),np.round(mx,1).tolist())
