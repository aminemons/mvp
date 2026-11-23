#!/usr/bin/env python3
"""CPU-only exploratory reconstruction of user-authorized phone footage.
This pipeline reconstructs observed geometry; it never invents a floor plan.
Output is an estimated point cloud, NOT a metrically accurate Matterport scan.
"""
import os,sys,subprocess,base64,json,zlib,shutil
from pathlib import Path
import cv2
import numpy as np
import onnxruntime as ort
from scipy.spatial.transform import Rotation

WORK=Path("work/reconstruction")
VIDEO="https://d2ol7oe51mr4n9.cloudfront.net/user_3LxvA5Gl3ZgqPX9FeucXcTI5fjL/e5c0a834-e8e8-4eb3-b44c-99673a8cf3d9.mp4"
DEPTH="https://huggingface.co/Heliosoph/midas-small-onnx/resolve/main/midas_v21_small_256.onnx"
OUT=Path("assets/reconstruction/scene-a.json")
def run(args,log=None):
    print("+", " ".join(map(str,args)),flush=True)
    if log:
        with open(log,"w") as f: subprocess.run(args,check=True,stdout=f,stderr=subprocess.STDOUT)
    else: subprocess.run(args,check=True)
def parse_model(root):
    imgs=[]
    lines=(root/"images.txt").read_text().splitlines()
    for j,ln in enumerate(lines[:-1]):
        a=ln.split()
        if len(a)!=10 or not a[0].isdigit():continue
        try: uv=np.array(lines[j+1].split(),dtype=np.float64).reshape(-1,3)
        except ValueError:continue
        q=[float(a[k]) for k in (2,3,4,1)]
        R=Rotation.from_quat(q).as_matrix()
        t=np.array(list(map(float,a[5:8])))
        imgs.append(dict(name=a[9],uv=uv,R=R,t=t,C=-R.T@t))
    pts={};rgb={}
    for line in (root/"points3D.txt").read_text().splitlines():
        if line.startswith("#"):continue
        a=line.split()
        if len(a)<8:continue
        pid=int(a[0]);pts[pid]=np.array(list(map(float,a[1:4])))
        rgb[pid]=np.array(list(map(int,a[4:7])),dtype=np.uint8)
    imgs.sort(key=lambda x:x["name"])
    return imgs,pts,rgb
def main():
    WORK.mkdir(parents=True,exist_ok=True)
    imgsdir=WORK/"images";imgsdir.mkdir(exist_ok=True)
    run(["curl","-LfsS","--retry","3",VIDEO,"-o",str(WORK/"input.mp4")])
    run(["ffmpeg","-loglevel","error","-y","-i",str(WORK/"input.mp4"),"-vf","fps=2.5","-q:v","2",str(imgsdir/"frame_%04d.jpg")])
    print("Frames:",len(list(imgsdir.glob("*.jpg"))),flush=True)
    db=WORK/"db.db";sparse=WORK/"sparse";sparse.mkdir(exist_ok=True)
    run(["colmap","feature_extractor","--database_path",db,"--image_path",imgsdir,"--ImageReader.single_camera","1","--ImageReader.camera_model","SIMPLE_RADIAL","--SiftExtraction.use_gpu","0","--SiftExtraction.num_threads","2","--SiftExtraction.max_num_features","3000"],WORK/"features.log")
    run(["colmap","sequential_matcher","--database_path",db,"--SiftMatching.use_gpu","0","--SiftMatching.num_threads","2","--SequentialMatching.overlap","18","--SequentialMatching.quadratic_overlap","1"],WORK/"matches.log")
    run(["colmap","mapper","--database_path",db,"--image_path",imgsdir,"--output_path",sparse,"--Mapper.min_num_matches","15","--Mapper.init_min_num_inliers","20","--Mapper.abs_pose_min_num_inliers","12","--Mapper.ba_refine_focal_length","0","--Mapper.ba_refine_extra_params","0","--Mapper.max_num_models","5"],WORK/"mapping.log")
    models=[]
    for p in sparse.iterdir():
        if p.is_dir():
            run(["colmap","model_converter","--input_path",p,"--output_path",p,"--output_type","TXT"],WORK/("convert_"+p.name+".log"))
            images,pts,rgb=parse_model(p)
            models.append((len(images),len(pts),p,images,pts,rgb))
    if not models:raise RuntimeError("No connected SfM model generated")
    registered,total,root,images,pts,rgb=max(models,reverse=True,key=lambda t:(t[0],t[1]))
    print("SfM result",registered,"registered frames and",total,"3D triangulations",flush=True)
    if registered<25 or total<500:raise RuntimeError("Reconstruction failed quality gate")
    up=np.median([e["R"].T@[0,-1,0] for e in images],axis=0);up/=np.linalg.norm(up)
    align=Rotation.align_vectors([[0,1,0]],[up])[0].as_matrix()
    origin=np.median(np.array([e["C"] for e in images]),axis=0)
    def world(x):return (x-origin)@align.T
    sparsexyz=world(np.array(list(pts.values())))
    lo=np.percentile(sparsexyz,2,axis=0);hi=np.percentile(sparsexyz,98,axis=0)
    pad=np.maximum(2.,(hi-lo)*.8);boundlo=lo-pad;boundhi=hi+pad
    run(["curl","-LfsS","--retry","3",DEPTH,"-o",str(WORK/"midas.onnx")])
    opts=ort.SessionOptions();opts.intra_op_num_threads=2
    net=ort.InferenceSession(str(WORK/"midas.onnx"),providers=["CPUExecutionProvider"],sess_options=opts)
    ptsout=[];colout=[];depthframes=[];fx=768.
    for idx,e in enumerate(images):
        if idx%2:continue
        im=cv2.imread(str(imgsdir/e["name"]))
        if im is None:continue
        h,w=im.shape[:2]
        inp=cv2.resize(im,(256,256),interpolation=cv2.INTER_AREA).astype("float32")/255.
        inp=(inp-np.array([.485,.456,.406],dtype="float32"))/np.array([.229,.224,.225],dtype="float32")
        pred=net.run(None,{net.get_inputs()[0].name:inp.transpose(2,0,1)[None].astype("float32")})[0][0]
        pred=cv2.resize(pred,(w,h))
        ids=e["uv"][:,2].astype(int);keep=np.array([id in pts for id in ids])
        if keep.sum()<35:continue
        uv=e["uv"][keep,:2];P=np.array([pts[id] for id in ids[keep]])
        z=(P@e["R"].T+e["t"])[:,2]
        valid=(z>.25)&(z<75);uv=uv[valid];z=z[valid]
        if len(z)<30:continue
        ix=np.clip(np.round(uv[:,0]).astype(int),0,w-1);iy=np.clip(np.round(uv[:,1]).astype(int),0,h-1)
        measured=pred[iy,ix].astype(float);inverse=1./z
        correlation=float(np.corrcoef(measured,inverse)[0,1])
        if not np.isfinite(correlation) or correlation<.36:continue
        median=np.median(measured);std=max(np.std(measured),1e-3)
        xn=(measured-median)/std
        A=np.stack([xn,np.ones_like(xn)],axis=1)
        fit=np.linalg.lstsq(A,inverse,rcond=None)[0]
        for _ in range(4):
            residual=inverse-A@fit
            sig=max(np.median(np.abs(residual-np.median(residual)))*1.4826,1e-5)
            weights=1/(1+(residual/(2.3*sig))**2)
            fit=np.linalg.lstsq(A*np.sqrt(weights[:,None]),inverse*np.sqrt(weights),rcond=None)[0]
        if fit[0]<=0:continue
        ys,xs=np.mgrid[3:h:6,3:w:6]
        invdepth=fit[0]*((pred[3:h:6,3:w:6]-median)/std)+fit[1]
        distance=np.clip(1/np.maximum(invdepth,1e-5),max(.2,np.percentile(z,2)*.7),min(65,np.percentile(z,98)*1.5))
        xyz=np.stack([(xs-w/2)*distance/fx,(ys-h/2)*distance/fx,distance],axis=-1).reshape(-1,3)
        cloud=world((xyz-e["t"])@e["R"])
        cols=im[3:h:6,3:w:6,::-1].reshape(-1,3)
        ok=np.logical_and(cloud>=boundlo,cloud<=boundhi).all(axis=1)&np.isfinite(cloud).all(axis=1)
        ptsout.append(cloud[ok].astype("float32"));colout.append(cols[ok].astype("uint8"))
        depthframes.append({"frame":e["name"],"corr":round(correlation,3),"tracks":int(len(z))})
        print("depth aligned",e["name"],int(ok.sum()),"corr",round(correlation,2),flush=True)
    if len(depthframes)<3:raise RuntimeError("Insufficient frames for reliable dense depth")
    xyz=np.concatenate(ptsout+[sparsexyz.astype("float32")])
    cols=np.concatenate(colout+[np.array([rgb[id] for id in pts],dtype="uint8")])
    lo=np.percentile(xyz,.2,axis=0)-.1;hi=np.percentile(xyz,99.8,axis=0)+.1
    good=np.logical_and(xyz>=lo,xyz<=hi).all(axis=1)&np.isfinite(xyz).all(axis=1)
    xyz=xyz[good];cols=cols[good]
    lo=xyz.min(axis=0);hi=xyz.max(axis=0);span=np.maximum(hi-lo,.001)
    quant=np.rint(np.clip((xyz-lo)/span*65535,0,65535)).astype("<u2")
    blocks=np.empty((len(xyz),9),dtype="uint8");blocks[:,:6]=quant.view("uint8").reshape((-1,6));blocks[:,6:]=cols
    compressed=zlib.compress(blocks.tobytes(),6)
    cameras=[]
    for e in images:
        forward=world(e["C"]+e["R"].T@np.array([0.,0.,1.]))-world(e["C"])
        cameras.append({"p":world(e["C"]).round(4).tolist(),"dir":forward.round(4).tolist(),"frame":e["name"],"sec":round((int(e["name"][6:10])-.5)/2.5,2)})
    result={
      "format":"vyral-xyzrgb-v1","count":len(xyz),"min":lo.tolist(),"max":hi.tolist(),
      "points":base64.b64encode(compressed).decode("ascii"),"cameraPath":cameras,
      "registeredFrames":registered,"sparsePoints":total,"depthFrames":len(depthframes),"depthChecks":depthframes,
      "description":"Real CPU SfM camera tracking with estimated monocular depth; non-metric and incomplete. No synthetic floors or walls."
    }
    OUT.parent.mkdir(parents=True,exist_ok=True)
    OUT.write_text(json.dumps(result,separators=(",",":")))
    print("DONE",OUT,"bytes",OUT.stat().st_size,"points",len(xyz),flush=True)
if __name__=="__main__":main()
