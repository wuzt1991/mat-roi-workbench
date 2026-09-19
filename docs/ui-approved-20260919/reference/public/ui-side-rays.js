/* Side Rays shader by David Haz / React Bits, adapted to native WebGL.
   Copyright (c) 2026 David Haz. MIT + Commons Clause.
   See licenses/react-bits-side-rays.txt and docs/ui-material-studies.md. */
(() => {
  'use strict';
  const vertex = `attribute vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }`;
  // Reference shader unchanged; intensity/falloff tuned to extend light across the workbench.
  const fragment = `precision highp float;
uniform float iTime;
uniform vec2 iResolution;
uniform float iSpeed;
uniform vec3 iRayColor1;
uniform vec3 iRayColor2;
uniform float iIntensity;
uniform float iSpread;
uniform float iFlipX;
uniform float iFlipY;
uniform float iTilt;
uniform float iSaturation;
uniform float iBlend;
uniform float iFalloff;
uniform float iOpacity;

float rayStrength(vec2 raySource, vec2 rayRefDirection, vec2 coord, float seedA, float seedB, float speed) {
  vec2 sourceToCoord = coord - raySource;
  float cosAngle = dot(normalize(sourceToCoord), rayRefDirection);
  return clamp(
    (0.45 + 0.15 * sin(cosAngle * seedA + iTime * speed)) +
    (0.3 + 0.2 * cos(-cosAngle * seedB + iTime * speed)),
    0.0, 1.0) *
    clamp((iResolution.x - length(sourceToCoord)) / iResolution.x, 0.5, 1.0);
}
void main() {
  vec2 fragCoord = gl_FragCoord.xy;
  if (iFlipX > 0.5) fragCoord.x = iResolution.x - fragCoord.x;
  if (iFlipY > 0.5) fragCoord.y = iResolution.y - fragCoord.y;
  vec2 coord = vec2(fragCoord.x, iResolution.y - fragCoord.y);
  vec2 rayPos = vec2(iResolution.x * 1.1, -0.5 * iResolution.y);
  float tiltRad = iTilt * 3.14159265 / 180.0;
  float cs = cos(tiltRad);
  float sn = sin(tiltRad);
  vec2 rel = coord - rayPos;
  vec2 tiltedCoord = vec2(rel.x * cs - rel.y * sn, rel.x * sn + rel.y * cs) + rayPos;
  float halfSpread = iSpread * 0.275;
  vec2 rayRefDir1 = normalize(vec2(cos(0.785398 + halfSpread), sin(0.785398 + halfSpread)));
  vec2 rayRefDir2 = normalize(vec2(cos(0.785398 - halfSpread), sin(0.785398 - halfSpread)));
  vec4 rays1 = vec4(iRayColor1, 1.0) * rayStrength(rayPos, rayRefDir1, tiltedCoord, 36.2214, 21.11349, iSpeed);
  vec4 rays2 = vec4(iRayColor2, 1.0) * rayStrength(rayPos, rayRefDir2, tiltedCoord, 22.3991, 18.0234, iSpeed * 0.2);
  vec4 color = rays1 * (1.0 - iBlend) * 0.9 + rays2 * iBlend * 0.9;
  float distanceToLight = length(fragCoord.xy - vec2(rayPos.x, iResolution.y - rayPos.y)) / iResolution.y;
  float brightness = iIntensity * 0.4 / pow(max(distanceToLight, 0.001), iFalloff);
  color.rgb *= brightness;
  float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
  color.rgb = mix(vec3(gray), color.rgb, iSaturation);
  color.a = max(color.r, max(color.g, color.b)) * iOpacity;
  gl_FragColor = color;
}`;

  function create(canvas) {
    // OGL's alpha-enabled renderer uses a non-premultiplied alpha context.
    const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false, antialias: false, depth: false });
    if (!gl) return null;
    const shaders = [];
    function compile(type, source) {
      const shader = gl.createShader(type);
      shaders.push(shader);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
      return shader;
    }
    const program = gl.createProgram();
    let buffer;
    try {
      gl.attachShader(program, compile(gl.VERTEX_SHADER, vertex));
      gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
      gl.useProgram(program);
      buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const position = gl.getAttribLocation(program, 'position');
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      const uniforms = {};
      for (const name of ['iTime', 'iResolution', 'iRayColor1', 'iRayColor2', 'iSpeed', 'iIntensity', 'iSpread', 'iFlipX', 'iFlipY', 'iTilt', 'iSaturation', 'iBlend', 'iFalloff', 'iOpacity']) {
        uniforms[name] = gl.getUniformLocation(program, name);
      }
      const defaults = { iSpeed: 2.5, iIntensity: 3.2, iSpread: 2, iFlipX: 0, iFlipY: 0, iTilt: 0, iSaturation: 1.5, iBlend: 0.75, iFalloff: 0.85, iOpacity: 1 };
      Object.entries(defaults).forEach(([name, value]) => gl.uniform1f(uniforms[name], value));
      gl.uniform3f(uniforms.iRayColor1, 234 / 255, 179 / 255, 8 / 255);
      gl.uniform3f(uniforms.iRayColor2, 150 / 255, 200 / 255, 1);
      return {
        resize(width, height) {
          // Match the reference renderer's native device-pixel resolution; there is no
          // default quality or frame-rate cap. Users can switch to Moonlight if needed.
          const dpr = Math.min(devicePixelRatio || 1, 2);
          canvas.width = Math.max(1, Math.round(width * dpr));
          canvas.height = Math.max(1, Math.round(height * dpr));
          gl.viewport(0, 0, canvas.width, canvas.height);
          gl.uniform2f(uniforms.iResolution, canvas.width, canvas.height);
        },
        render(time) {
          gl.uniform1f(uniforms.iTime, time);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
        },
        destroy() {
          gl.deleteBuffer(buffer);
          gl.deleteProgram(program);
          shaders.forEach(shader => gl.deleteShader(shader));
        }
      };
    } catch (error) {
      if (buffer) gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      shaders.forEach(shader => gl.deleteShader(shader));
      console.warn('Side Rays could not initialize:', error.message);
      return null;
    }
  }
  window.UiSideRays = { create };
})();
