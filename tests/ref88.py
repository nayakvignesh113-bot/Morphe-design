# Independent reference: top88 (Andreassen et al. 2011), density filter, scipy sparse direct solver
import numpy as np, scipy.sparse as sp, scipy.sparse.linalg as sla, sys, json
# Usage: python3 tests/ref88.py 60 > tests/top88_reference.json
#        python3 tests/ref88.py 60 2 > tests/top88_reference_2cases.json   (two load cases, summed compliance)
nelx,nely,volfrac,penal,rmin,iters=60,20,0.5,3.0,1.5,int(sys.argv[1])
two_cases = len(sys.argv) > 2 and sys.argv[2] == '2'  # second case: downward load at top-centre
E0,Emin,nu=1,1e-9,0.3
A11=np.array([[12,3,-6,-3],[3,12,3,0],[-6,3,12,-3],[-3,0,-3,12]])
A12=np.array([[-6,-3,0,3],[-3,-6,-3,-6],[0,-3,-6,3],[3,-6,3,-6]])
B11=np.array([[-4,3,-2,9],[3,-4,-9,4],[-2,-9,-4,-3],[9,4,-3,-4]])
B12=np.array([[2,-3,4,-9],[-3,2,9,-2],[4,9,2,3],[-9,-2,3,2]])
KE=1/(1-nu**2)/24*(np.block([[A11,A12],[A12.T,A11]])+nu*np.block([[B11,B12],[B12.T,B11]]))
nodenrs=np.arange((1+nelx)*(1+nely)).reshape(1+nelx,1+nely).T
edofVec=(2*nodenrs[:-1,:-1]+2).T.reshape(-1)  # 0-based: 2*n+2 -> x dof of node below
edofMat=edofVec[:,None]+np.array([0,1,2*nely+2,2*nely+3,2*nely,2*nely+1,-2,-1])
iK=np.kron(edofMat,np.ones((8,1),int)).reshape(-1); jK=np.kron(edofMat,np.ones((1,8),int)).reshape(-1)
ndof=2*(nelx+1)*(nely+1)
F=np.zeros((ndof,2 if two_cases else 1)); F[1,0]=-1
if two_cases: F[2*(nelx//2)*(nely+1)+1,1]=-1
fixed=np.union1d(np.arange(0,2*(nely+1),2),[ndof-1]); free=np.setdiff1d(np.arange(ndof),fixed)
# filter
rows,cols,vals=[],[],[]
for i in range(nelx):
  for j in range(nely):
    e1=i*nely+j
    for k in range(max(i-int(np.ceil(rmin))+1,0),min(i+int(np.ceil(rmin)),nelx)):
      for l in range(max(j-int(np.ceil(rmin))+1,0),min(j+int(np.ceil(rmin)),nely)):
        e2=k*nely+l; w=max(0,rmin-np.hypot(i-k,j-l))
        if w>0: rows.append(e1);cols.append(e2);vals.append(w)
H=sp.csr_matrix((vals,(rows,cols)),shape=(nelx*nely,nelx*nely)); Hs=np.array(H.sum(1)).ravel()
x=np.full(nelx*nely,volfrac); xPhys=x.copy(); hist=[]
for it in range(iters):
  sK=(KE.reshape(-1)[None,:]*(Emin+xPhys[:,None]**penal*(E0-Emin))).reshape(-1)
  K=sp.csc_matrix((sK,(iK,jK)),shape=(ndof,ndof)); K=(K+K.T)/2
  U=np.zeros(F.shape); sol=sla.spsolve(K[free][:,free],F[free]); U[free]=sol.reshape(len(free),-1)
  ce=sum(np.sum((U[edofMat,k]@KE)*U[edofMat,k],1) for k in range(F.shape[1]))
  c=np.sum((Emin+xPhys**penal*(E0-Emin))*ce); hist.append(c)
  dc=-penal*(E0-Emin)*xPhys**(penal-1)*ce; dv=np.ones_like(x)
  dc=H@(dc/Hs); dv=H@(dv/Hs)
  l1,l2,move=0,1e9,0.2
  while (l2-l1)/(l1+l2)>1e-4:
    lm=0.5*(l1+l2)
    xnew=np.maximum(0,np.maximum(x-move,np.minimum(1,np.minimum(x+move,x*np.sqrt(-dc/dv/lm)))))
    xPhys=(H@xnew)/Hs
    if xPhys.sum()>volfrac*nelx*nely: l1=lm
    else: l2=lm
  x=xnew
print(json.dumps(hist))
