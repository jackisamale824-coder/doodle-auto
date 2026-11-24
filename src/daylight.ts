import * as T from "three";
import { randomSeed } from "./world.ts";

export function daylightSky() {
  const random = randomSeed("daylight-clouds");
  const grain = Uint8Array.from({ length: 128 * 128 }, () => random() * 255);
  const noise = new T.DataTexture(grain, 128, 128, T.RedFormat);
  noise.wrapS = noise.wrapT = T.RepeatWrapping;
  noise.magFilter = T.LinearFilter;
  noise.minFilter = T.LinearMipmapLinearFilter;
  noise.generateMipmaps = noise.needsUpdate = true;

  const material = new T.ShaderMaterial({
    side: T.BackSide,
    depthWrite: false,
    uniforms: {
      zenith: { value: new T.Color() },
      horizon: { value: new T.Color() },
      noise: { value: noise },
    },
    vertexShader: `varying vec3 ray;
      void main(){
        ray=position;
        vec4 clip=projectionMatrix*vec4(mat3(viewMatrix)*position,1.);
        gl_Position=clip.xyww;
      }`,
    fragmentShader: `uniform vec3 zenith,horizon;
      uniform sampler2D noise;
      varying vec3 ray;
      float softNoise(vec2 uv){
        vec2 pixel=uv*128.-.5, f=fract(pixel);
        return texture2D(noise,(floor(pixel)+f*f*(3.-2.*f)+.5)/128.).r;
      }
      void main(){
        vec3 d=normalize(ray);
        float h=max(0.,d.y);
        vec3 sky=mix(horizon,zenith,1.-exp(-3.4*h));
        vec2 uv=d.xz/(.12+h)*vec2(.014,.018);
        uv+=.006*vec2(softNoise(uv*.8+.13),softNoise(uv*.8+.61));
        float cloud=.52*softNoise(uv)+.28*softNoise(uv*2.13+.29)+.14*softNoise(uv*4.53-.17)+.06*softNoise(uv*9.1);
        vec3 cloudLight=mix(vec3(.60,.72,.79),vec3(.99,.93,.81),smoothstep(.50,.78,cloud));
        sky=mix(sky,cloudLight,.72*smoothstep(.50,.76,cloud)*smoothstep(.015,.22,h));
        float sun=max(0.,dot(d,normalize(vec3(-48.,72.,30.))));
        sky+=vec3(.6,.36,.14)*pow(sun,32.);
        gl_FragColor=vec4(mix(sky,vec3(1.,.92,.69),smoothstep(.99925,.99955,sun)),1.);
        #include <colorspace_fragment>
      }`,
  });
  const sky = new T.Mesh(new T.SphereGeometry(1, 32, 16), material);
  sky.frustumCulled = false;
  sky.renderOrder = 1000;
  return sky;
}
