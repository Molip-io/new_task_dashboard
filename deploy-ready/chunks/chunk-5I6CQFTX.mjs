function u({ttlMs:n=6e4,now:t=()=>Date.now()}={}){let e=null,r=0;return{get(){return e&&t()<r?e:null},set(l){return e=l,r=t()+n,l},clear(){e=null,r=0}}}export{u as a};
