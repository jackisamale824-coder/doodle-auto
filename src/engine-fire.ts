import * as T from "three";

// One animated, camera-facing sheet per burning bonnet. Its origin stays attached
// to the vehicle while the plumes rise in world space.
export function engineFire() {
  const material = new T.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { heat: { value: 0 }, time: { value: 0 } },
    vertexShader: `
      uniform float heat;
      varying vec2 vUv;
      void main() {
        vUv=uv;
        vec4 center=modelViewMatrix*vec4(0.,0.,0.,1.);
        center.x+=position.x*(0.42+1.48*heat);
        center.xyz+=(viewMatrix*vec4(0.,1.,0.,0.)).xyz*(position.y+0.5)*(0.38+1.62*heat);
        gl_Position=projectionMatrix*center;
      }`,
    fragmentShader: `
      uniform float time;
      varying vec2 vUv;
      float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float noise(vec2 p){
        vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),
          mix(hash(i+vec2(0,1)),hash(i+vec2(1)),f.x),f.y);
      }
      void main(){
        float y=vUv.y;
        vec2 flow=vec2(vUv.x*4.7,y*4.-time*2.8);
        float n=noise(flow)*0.64+noise(flow*2.31)*0.36;
        float x=(vUv.x-.5)*2.+(noise(flow*.72)-.5)*.42*y;
        float tongues=.13*sin(16.*x+4.*noise(flow*.61)+time*2.3)*smoothstep(.1,.65,y);
        float field=.94-abs(x)*1.12-y*1.17+(n-.53)*(.73+y*1.35)+tongues;
        float alpha=smoothstep(.035,.22,field)*smoothstep(0.,.085,y)*(1.-smoothstep(.9,1.,y));
        if(alpha<.01) discard;
        vec3 ember=mix(vec3(.73,.047,.005),vec3(1.,.36,.012),smoothstep(.14,.49,field));
        vec3 flame=mix(ember,vec3(1.,.89,.36),smoothstep(.46,.84,field));
        gl_FragColor=vec4(flame,alpha*.96);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new T.Mesh(new T.PlaneGeometry(1, 1), material);
  mesh.name = "engine-fire";
  mesh.frustumCulled = false;
  return mesh;
}
