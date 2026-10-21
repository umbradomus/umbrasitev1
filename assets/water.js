/* THE BOSS WATER on the site - 3UMBRA2 10-21. Ported from BOSS CODE\BOSS-GUI\boss-frame.js (BB58): domain-warped value noise
   (Quilez 2002), one triangle, one loop. Colours per canvas via data-deep / data-lit / data-bright. Stops when the tab is hidden;
   holds still under reduced-motion; skipped on phones (< 760px) - the flat colours stay. */
function umbraWater(cv, opts){
  opts = opts || {};
  var deep = opts.deep || [0/255,49/255,83/255], lit = opts.lit || [47/255,107/255,176/255];
  var bright = opts.bright || 0.45, speed = opts.speed || 0.9, scale = opts.scale || 0.9;
  var gl = cv.getContext('webgl', {antialias:false, alpha:false, premultipliedAlpha:false});
  if (!gl) return null;
  var VS='attribute vec2 p; void main(){ gl_Position=vec4(p,0.0,1.0); }';
  var FS=['precision highp float;','uniform vec2 uRes;','uniform float uTime;','uniform float uSpeed;','uniform float uScale;','uniform float uBright;','uniform vec3 uDeep;','uniform vec3 uLit;','uniform float uHorizon;',
  'const float e = 2.71828182845904523536;',
  'float grain(vec2 c){ float G = e; vec2 r = (G * sin(G * c)); return fract(r.x * r.y * (1.0 + c.x)); }',
  'float hash21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }',
  'float vnoise(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);',
  '  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y); }',
  'float fbm(vec2 p){ float v = 0.0; float a = 0.5; mat2 m = mat2(1.6, 1.2, -1.2, 1.6);',
  '  for (int i = 0; i < 4; i++) { v += a * vnoise(p); p = m * p; a *= 0.5; } return v; }',
  'void main(){',
  '  vec2 uv = gl_FragCoord.xy / uRes; uv.x *= uRes.x / uRes.y;',
  '  vec2 p = uv * uScale * 1.9; float t = uSpeed * uTime * 0.45;',
  '  vec2 q = vec2(fbm(p + 0.40 * t), fbm(p + vec2(5.2, 1.3) - 0.28 * t));',
  '  vec2 r = vec2(fbm(p + 3.4 * q + vec2(1.7, 9.2) + 0.32 * t), fbm(p + 3.4 * q + vec2(8.3, 2.8) - 0.24 * t));',
  '  float f = fbm(p + 3.0 * r);',
  '  float body = smoothstep(0.30, 0.68, f);',
  '  float fold = pow(max(0.0, 1.0 - abs(f - 0.56) * 5.0), 2.0);',
  '  float k = (pow(body, 1.35) * 0.80 + fold * 0.50) * uBright;',
  '  float yy = gl_FragCoord.y / uRes.y;',   /* 1 at the top edge */
  '  k *= mix(1.0, pow(smoothstep(0.15, 1.0, yy), 1.4) * 1.6, uHorizon);',   /* the horizon: crests lit near the top, black below */
  '  vec3 col = mix(uDeep, uLit, clamp(k, 0.0, 1.0));',
  '  col -= (grain(gl_FragCoord.xy) - 0.5) * (1.0 / 48.0);',
  '  gl_FragColor = vec4(col, 1.0);','}'].join('\n');
  function sh(t,s){var o=gl.createShader(t);gl.shaderSource(o,s);gl.compileShader(o);return o;}
  var pr=gl.createProgram();gl.attachShader(pr,sh(gl.VERTEX_SHADER,VS));gl.attachShader(pr,sh(gl.FRAGMENT_SHADER,FS));gl.linkProgram(pr);gl.useProgram(pr);
  var b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
  var a=gl.getAttribLocation(pr,'p');gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,2,gl.FLOAT,false,0,0);
  var U=function(n){return gl.getUniformLocation(pr,n);};
  gl.uniform1f(U('uSpeed'),speed);gl.uniform1f(U('uScale'),scale);gl.uniform1f(U('uBright'),bright);gl.uniform3fv(U('uDeep'),deep);gl.uniform3fv(U('uLit'),lit);gl.uniform1f(U('uHorizon'),opts.horizon||0);
  var uRes=U('uRes'),uTime=U('uTime'),t=opts.t0||0,last=0,raf=0;
  var still = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  function size(){var d=Math.min(1.5,devicePixelRatio||1);var w=Math.round(cv.clientWidth*d),h=Math.round(cv.clientHeight*d);if(cv.width!==w||cv.height!==h){cv.width=w;cv.height=h;gl.viewport(0,0,w,h);}gl.uniform2f(uRes,cv.width,cv.height);}
  function frame(now){if(last)t+=Math.min(0.05,(now-last)/1000);last=now;size();gl.uniform1f(uTime,t);gl.drawArrays(gl.TRIANGLES,0,3);if(!still&&!document.hidden)raf=requestAnimationFrame(frame);}
  document.addEventListener('visibilitychange',function(){if(!document.hidden&&!raf){last=0;raf=requestAnimationFrame(frame);}else if(document.hidden){cancelAnimationFrame(raf);raf=0;}});
  raf=requestAnimationFrame(frame);
  return {canvas:cv};
}
function hex(h){h=h.replace('#','');return [parseInt(h.substr(0,2),16)/255,parseInt(h.substr(2,2),16)/255,parseInt(h.substr(4,2),16)/255];}
(function(){
  if (!window.matchMedia || matchMedia('(max-width: 759px)').matches) return;
  Array.prototype.forEach.call(document.querySelectorAll('canvas[data-water]'), function(cv){
    try { umbraWater(cv, { deep: hex(cv.dataset.deep||'#003153'), lit: hex(cv.dataset.lit||'#2F6BB0'), bright: parseFloat(cv.dataset.bright||'0.45'), t0: parseFloat(cv.dataset.t0||'0'), horizon: parseFloat(cv.dataset.horizon||'0') }); } catch (e) {}
  });
})();
