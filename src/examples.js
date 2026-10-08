// Constructions d'exemple (chargées par le menu « Exemples »).
export const EXAMPLES = [
  { name: 'Cube : (AG) ⟂ plan (BDE)', dim: 3, range: 8, select: ['d', 'p'], lines: [
    'A=(0,0,0)', 'B=(4,0,0)', 'C=(4,4,0)', 'D=(0,4,0)', 'E=(0,0,4)', 'F=(4,0,4)', 'G=(4,4,4)', 'H=(0,4,4)',
    'cube=Cube(A,4)', 'd=Droite(A,G)', 'p: Plan(B,D,E)', 'I=Intersection(d,p)', 'k=Distance(A,p)'] },
  { name: 'Projeté orthogonal sur un plan', dim: 3, range: 8, select: ['M', 'p'], lines: [
    'A=(4,0,0)', 'B=(0,3,0)', 'C=(0,0,2)', 'p: Plan(A,B,C)', 'M=(3,3,4)', 'H=Projeté(M,p)', 's=Segment(M,H)', 'k=Distance(M,p)'] },
  { name: 'Tétraèdre régulier', dim: 3, range: 8, select: ['T'], lines: [
    'A=(0,0,0)', 'T=TétraèdreRégulier(A,5)', 'B=Sommet(T,2)', 'C=Sommet(T,3)', 'D=Sommet(T,4)', 'I=Milieu(B,C)', 's=Segment(A,I)', 'G=Barycentre(A,1,B,1,C,1)', 'h=Droite(D,G)'] },
  { name: 'Sphère coupée par un plan', dim: 3, range: 8, select: ['c'], lines: [
    'O=(0,0,0)', 'sph=Sphère(O,5)', 'p: z=3', 'c=Intersection(p,sph)', 'A=(0,0,5)', 'd=Droite(O,A)'] },
  { name: 'Base et vecteurs', dim: 3, range: 8, select: ['b', 'r'], lines: [
    'O=(0,0,0)', 'u=(3,0,0)', 'v=(1,2,0)', 'w=(0,1,3)', 'b=Base(O,u,v,w)', 'r=(3,4,5)', 'k=Déterminant(u,v,w)'] },
  { name: 'Repère non orthonormé', dim: 3, range: 8, select: [], lines: [
    'BaseRepère((1,0,0),(0.6,1,0),(0,0,1))', 'A=(2,2,0)', 'B=(2,0,3)', 'C=(0,2,2)', 'p: Plan(A,B,C)', 'u=Vecteur(A,B)', 'v=Vecteur(A,C)', 'k=u*v'] },
  { name: 'Cercle et droite (2D)', dim: 2, range: 8, select: ['d', 'c'], lines: [
    'Repère(2)', 'A=(1,1)', 'B=(4,3)', 'c=Cercle(A,B)', 'd: x+2y=7', 'I=Intersection(d,c)', 'J=Intersection(d,c,2)', 'M=Milieu(I,J)', 'm=Médiatrice(I,J)'] },
  { name: 'Hypercube en 4D', dim: 4, range: 4, select: ['T'], lines: [
    'Repère(4)', 'O=(-1,-1,-1,-1)', 'T=Hypercube(O,2)', 'E=(1,1,1,1)', 's=Segment(O,E)', 'k=Distance(O,E)'] },
];
