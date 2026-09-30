/* Visual presentation only. Flight, collision, route replay and nerve stay in game.js. */
(() => {
  'use strict';
  const T = window.THREE;
  window.VectorfallPresentation = class {
    constructor(renderer, scene, camera, arena, player, random) {
      Object.assign(this, { renderer, scene, camera, arena, player });
      this.high = true;
      this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.elapsed = 0;
      this.frameCount = 0;
      this.frameStart = performance.now();
      this.frameRate = document.getElementById('frame-rate');
      this.reflectionFrame = 0;
      this.hudTimer = 0;
      this.rad = document.getElementById('radar').getContext('2d');
      this.marker = document.getElementById('spark-marker');
      this.distanceEl = document.getElementById('target-distance');
      this.echoEl = document.getElementById('echo-count');
      this.projected = new T.Vector3();
      this.qualityBtn = document.getElementById('quality');
      this.buildCity(random);
      this.buildArchitecture();
      this.detailCraft();
      this.buildAtmosphere(random);
      this.buildEnvironment();
      this.buildReflection();
      this.buildPost();
      this.resize();
      this.qualityBtn.addEventListener('click', () => {
        this.high = !this.high;
        this.qualityBtn.querySelector('b').textContent = this.high ? 'HIGH' : 'LITE';
        this.renderer.setPixelRatio(Math.min(devicePixelRatio, this.high ? 1.75 : 1));
        this.renderer.setSize(innerWidth, innerHeight);
        this.rays.visible = this.high;
        this.reflection.visible = this.high;
        this.resize();
      });
    }

    material(color, metalness = 0.3, roughness = 0.35, emissive = 0, intensity = 0) {
      return new T.MeshStandardMaterial({ color, metalness, roughness, emissive, emissiveIntensity: intensity });
    }

    buildCity(rand) {
      const city = new T.Group();
      const concrete = this.material(0x4c7175, 0.25, 0.55);
      const dark = this.material(0x133b42, 0.55, 0.24);
      const brass = this.material(0xbb9b6b, 0.75, 0.25);
      const glow = new T.MeshBasicMaterial({ color: 0xffce8d });
      const windows = new T.InstancedMesh(new T.BoxGeometry(1, 1, 1), glow, 360);
      const dummy = new T.Object3D();
      let wi = 0;
      for (let i = 0; i < 30; i++) {
        const angle = Math.PI * 0.65 + i / 29 * Math.PI * 0.7;
        const radius = 70 + rand() * 38;
        const height = 8 + rand() * 19;
        const width = 3 + rand() * 5;
        const x = Math.sin(angle) * radius, z = Math.cos(angle) * radius;
        const building = new T.Mesh(new T.CylinderGeometry(width * 0.74, width, height, i % 3 ? 8 : 24), i % 2 ? concrete : dark);
        building.position.set(x, height / 2 - 8, z);
        city.add(building);
        for (let j = 0; j < 4; j++) {
          const fin = new T.Mesh(new T.BoxGeometry(0.25, height + 2, width * 2.1), brass);
          fin.position.copy(building.position);
          fin.rotation.y = j * Math.PI / 4;
          city.add(fin);
        }
        for (let j = 1; j <= 8; j++) {
          const yy = j / 9 * height - 8;
          const front = Math.atan2(-x, -z);
          dummy.position.set(x + Math.sin(front) * width * 0.94, yy, z + Math.cos(front) * width * 0.94);
          dummy.rotation.set(0, front, 0);
          dummy.scale.set(width * 1.2, 0.12, 0.1);
          dummy.updateMatrix();
          windows.setMatrixAt(wi++, dummy.matrix);
        }
        if (i % 6 === 0) {
          const saucer = new T.Mesh(new T.SphereGeometry(width * 1.9, 32, 16), concrete);
          saucer.scale.y = 0.18;
          saucer.position.set(x, height - 7, z);
          city.add(saucer);
          const ring = new T.Mesh(new T.TorusGeometry(width * 1.88, 0.085, 6, 48), glow);
          ring.rotation.x = Math.PI / 2;
          ring.position.copy(saucer.position);
          city.add(ring);
        }
      }
      windows.count = wi;
      city.add(windows);
      this.scene.add(city);
      const planet = new T.Mesh(new T.SphereGeometry(14, 48, 32), this.material(0xb4c8bd, 0, 1));
      planet.position.set(65, 60, -130);
      this.scene.add(planet);
      const orbit = new T.Mesh(new T.RingGeometry(19, 23, 96), new T.MeshBasicMaterial({color: 0xb1c8bb, side: T.DoubleSide, transparent:true, opacity:0.24, depthWrite:false}));
      orbit.position.copy(planet.position);
      orbit.rotation.set(1.1, 0.2, -0.3);
      this.scene.add(orbit);
    }

    buildArchitecture() {
      const brass = this.material(0xbca26d, 0.8, 0.24);
      const ivory = this.material(0xcbd6cd, 0.2, 0.36);
      const amber = new T.MeshBasicMaterial({ color: 0xffc184 });
      const teal = new T.MeshBasicMaterial({ color: 0x6ccfc6 });
      for (const r of [10.8, 14, 22, 30, 37.5]) {
        const ring = new T.Mesh(new T.TorusGeometry(r, r === 10.8 ? 0.075 : 0.025, 6, 128), r === 10.8 ? amber : brass);
        ring.rotation.x = Math.PI / 2;
        ring.position.y = r === 10.8 ? 14.8 : 0.035;
        this.arena.add(ring);
      }
      for (let i = 0; i < 24; i++) {
        const a = i / 24 * Math.PI * 2;
        const rib = new T.Mesh(new T.BoxGeometry(0.14, 0.27, 26), brass);
        rib.position.set(Math.sin(a) * 24, 14.82, Math.cos(a) * 24);
        rib.rotation.y = a;
        this.arena.add(rib);
        const tick = new T.Mesh(new T.BoxGeometry(0.06, 0.018, i % 3 ? 0.35 : 0.8), i % 3 ? brass : amber);
        tick.position.set(Math.sin(a) * 30, 0.04, Math.cos(a) * 30);
        tick.rotation.y = a;
        this.arena.add(tick);
      }
      // Narrow illuminated glass fins give the rear wall architectural rhythm.
      for (let i = 0; i < 18; i++) {
        const a = i / 18 * Math.PI * 2;
        const post = new T.Mesh(new T.BoxGeometry(0.24, 12, 0.45), ivory);
        post.position.set(Math.sin(a) * 37.6, 7, Math.cos(a) * 37.6);
        post.rotation.y = a;
        this.arena.add(post);
        const light = new T.Mesh(new T.BoxGeometry(0.045, 9.5, 0.05), i % 3 ? amber : teal);
        light.position.set(Math.sin(a) * 37.32, 7, Math.cos(a) * 37.32);
        this.arena.add(light);
      }
      // An armillary instrument floats above the hearth, clear of the flight plane.
      this.armillary = new T.Group();
      this.armillary.position.y = 8.4;
      for (let i = 0; i < 3; i++) {
        const ring = new T.Mesh(new T.TorusGeometry(2.6 + i * 0.28, 0.042, 8, 96), brass);
        ring.rotation.set(i * 0.8, i * 1.1, Math.PI / 3);
        this.armillary.add(ring);
      }
      const globe = new T.Mesh(new T.IcosahedronGeometry(1.15, 2), new T.MeshStandardMaterial({color:0x327e81, metalness:0.65, roughness:0.18, emissive:0x0b4e50, emissiveIntensity:0.8, wireframe:true}));
      this.armillary.add(globe);
      this.arena.add(this.armillary);
    }

    detailCraft() {
      const chrome = new T.MeshPhysicalMaterial({color:0xd0dbd7, metalness:0.9, roughness:0.19, clearcoat:1, clearcoatRoughness:0.15});
      this.player.children[0].material = new T.MeshPhysicalMaterial({color:0xeee8d7, metalness:0.36, roughness:0.2, clearcoat:1, clearcoatRoughness:0.12});
      for (const side of [-1, 1]) {
        const nacelle = new T.Mesh(new T.CylinderGeometry(0.18, 0.24, 1.25, 24), chrome);
        nacelle.rotation.x = Math.PI / 2;
        nacelle.position.set(side * 0.87, -0.06, 0.25);
        this.player.add(nacelle);
        const thruster = new T.Mesh(new T.TorusGeometry(0.18, 0.038, 8, 32), new T.MeshBasicMaterial({color:0x93fff1}));
        thruster.position.set(side * 0.87, -0.06, 0.89);
        this.player.add(thruster);
        for (let i = 0; i < 4; i++) {
          const vent = new T.Mesh(new T.BoxGeometry(0.025, 0.028, 0.35), chrome);
          vent.position.set(side * (0.52 + i * 0.075), 0.16, 0.23);
          this.player.add(vent);
        }
      }
      const underglow = new T.PointLight(0x5be9de, 7, 5, 2);
      underglow.position.y = -0.4;
      this.player.add(underglow);
      this.player.children[2].material = new T.MeshPhysicalMaterial({color:0x377d85, metalness:0.45, roughness:0.08, transparent:true, opacity:0.8, clearcoat:1});
    }

    buildAtmosphere(rand) {
      const points = new Float32Array(420 * 3);
      for (let i = 0; i < points.length; i += 3) {
        const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * 36;
        points[i] = Math.cos(a) * r;
        points[i + 1] = 0.4 + rand() * 14;
        points[i + 2] = Math.sin(a) * r;
      }
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.BufferAttribute(points, 3));
      this.dust = new T.Points(geo, new T.ShaderMaterial({
        uniforms:{time:{value:0}},
        vertexShader:`uniform float time; varying float alpha; void main(){vec3 p=position;p.x+=sin(time*.13+p.y)*.3;p.y=mod(p.y+time*.065,14.);vec4 mv=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;gl_PointSize=clamp(34./-mv.z,1.,3.);alpha=.2+.3*sin(p.x+time*.4)*sin(p.x+time*.4);}`,
        fragmentShader:`varying float alpha;void main(){float d=length(gl_PointCoord-.5);gl_FragColor=vec4(.85,.91,.78,(1.-smoothstep(.12,.5,d))*alpha);}`,
        transparent:true,depthWrite:false,blending:T.AdditiveBlending
      }));
      this.scene.add(this.dust);
      this.rays = new T.Group();
      const rayMat = new T.ShaderMaterial({
        vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
        fragmentShader:`varying vec2 vUv;void main(){float edge=pow(sin(vUv.x*3.14159),3.);float fade=sin(vUv.y*3.14159);gl_FragColor=vec4(.55,.82,.82,edge*fade*.035);}`,
        transparent:true,depthWrite:false,side:T.DoubleSide,blending:T.AdditiveBlending
      });
      for (let i = 0; i < 5; i++) {
        const ray = new T.Mesh(new T.PlaneGeometry(3.5, 20), rayMat);
        ray.position.set(-12 + i * 6, 8, -12);
        ray.rotation.set(0, -0.3, -0.5);
        this.rays.add(ray);
      }
      this.scene.add(this.rays);
    }

    buildEnvironment() {
      // Capture the actual architecture once for physically based metal/glass reflections.
      const target = new T.WebGLCubeRenderTarget(128, {type:T.HalfFloatType});
      const probe = new T.CubeCamera(0.1, 240, target);
      probe.position.set(0, 6, 2);
      this.player.visible = false;
      probe.update(this.renderer, this.scene);
      this.player.visible = true;
      const generator = new T.PMREMGenerator(this.renderer);
      this.environment = generator.fromCubemap(target.texture);
      this.scene.environment = this.environment.texture;
      this.scene.traverse(obj => {
        if (obj.material?.isMeshStandardMaterial) obj.material.envMapIntensity = 0.65;
      });
      target.dispose();
      generator.dispose();
    }

    buildPost() {
      this.full = new T.WebGLRenderTarget(1, 1, {depthBuffer:true});
      this.blurA = new T.WebGLRenderTarget(1, 1, {depthBuffer:false});
      this.blurB = new T.WebGLRenderTarget(1, 1, {depthBuffer:false});
      this.postScene = new T.Scene();
      this.postCamera = new T.OrthographicCamera(-1,1,1,-1,0,1);
      const vertexShader = `varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}`;
      this.blur = new T.ShaderMaterial({
        uniforms:{source:{value:null},direction:{value:new T.Vector2()},threshold:{value:0}},vertexShader,
        fragmentShader:`uniform sampler2D source;uniform vec2 direction;uniform float threshold;varying vec2 vUv;
          vec3 tap(vec2 p){vec3 c=texture2D(source,p).rgb;float l=max(max(c.r,c.g),c.b);return c*smoothstep(threshold,threshold+.22,l);}
          void main(){vec3 c=tap(vUv)*.227027;c+=(tap(vUv+direction*1.384615)+tap(vUv-direction*1.384615))*.316216;c+=(tap(vUv+direction*3.230769)+tap(vUv-direction*3.230769))*.070270;gl_FragColor=vec4(c,1.);}`,
        depthTest:false,depthWrite:false,toneMapped:false
      });
      this.composite = new T.ShaderMaterial({
        uniforms:{source:{value:this.full.texture},bloom:{value:this.blurB.texture},strength:{value:0.26},time:{value:0}},vertexShader,
        fragmentShader:`uniform sampler2D source;uniform sampler2D bloom;uniform float strength;uniform float time;varying vec2 vUv;
          void main(){vec3 c=texture2D(source,vUv).rgb;c+=texture2D(bloom,vUv).rgb*strength;
          c=mix(c,c*vec3(.88,1.025,1.045),.18*(1.-smoothstep(.12,.7,dot(c,vec3(.2126,.7152,.0722)))));
          float v=1.-.20*pow(length((vUv-.5)*vec2(1.,.8))*1.4,2.);c*=v;
          c+=(fract(sin(dot(vUv+fract(time),vec2(12.9898,78.233)))*43758.5453)-.5)/420.;
          gl_FragColor=vec4(c,1.);
          #include <colorspace_fragment>
          }`,
        depthTest:false,depthWrite:false,toneMapped:false
      });
      this.quad = new T.Mesh(new T.PlaneGeometry(2,2),this.composite);
      this.postScene.add(this.quad);
    }

    buildReflection() {
      this.reflectionTarget = new T.WebGLRenderTarget(640,360);
      this.reflectionCamera = new T.PerspectiveCamera();
      this.reflectionMatrix = new T.Matrix4();
      this.reflectDirection = new T.Vector3();
      this.reflectLookAt = new T.Vector3();
      this.floor = this.scene.getObjectByName('observatory-floor');
      this.reflectionPlane = new T.Plane(new T.Vector3(0,1,0),-0.08);
      const material = new T.ShaderMaterial({
        uniforms:{reflectionMap:{value:this.reflectionTarget.texture},textureMatrix:{value:this.reflectionMatrix},texel:{value:new T.Vector2(1/640,1/360)}},
        vertexShader:`uniform mat4 textureMatrix;varying vec4 vReflection;varying vec3 vWorld;
          void main(){vec4 w=modelMatrix*vec4(position,1.);vWorld=w.xyz;vReflection=textureMatrix*w;gl_Position=projectionMatrix*viewMatrix*w;}`,
        fragmentShader:`uniform sampler2D reflectionMap;uniform vec2 texel;varying vec4 vReflection;varying vec3 vWorld;
          void main(){vec2 uv=vReflection.xy/vReflection.w;vec3 c=texture2D(reflectionMap,uv).rgb*.4;
          c+=(texture2D(reflectionMap,uv+texel*2.).rgb+texture2D(reflectionMap,uv-texel*2.).rgb+texture2D(reflectionMap,uv+vec2(texel.x,-texel.y)*2.).rgb+texture2D(reflectionMap,uv+vec2(-texel.x,texel.y)*2.).rgb)*.15;
          float fres=pow(1.-max(0.,normalize(cameraPosition-vWorld).y),3.);
          gl_FragColor=vec4(c,.06+fres*.19);
          #include <colorspace_fragment>
          }`,
        transparent:true,depthWrite:false,toneMapped:false
      });
      this.reflection = new T.Mesh(new T.CircleGeometry(27.7,96),material);
      this.reflection.rotation.x=-Math.PI/2;
      this.reflection.position.y=0.023;
      this.scene.add(this.reflection);
    }

    updateReflection() {
      const r=this.renderer, c=this.reflectionCamera;
      c.copy(this.camera);
      c.position.y=-this.camera.position.y;
      this.camera.getWorldDirection(this.reflectDirection);
      this.reflectDirection.y=-this.reflectDirection.y;
      this.reflectLookAt.copy(c.position).add(this.reflectDirection);
      c.up.set(0,-1,0);
      c.lookAt(this.reflectLookAt);
      c.updateMatrixWorld();
      this.reflectionMatrix.set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1);
      this.reflectionMatrix.multiply(c.projectionMatrix).multiply(c.matrixWorldInverse);
      this.floor.visible=false;this.reflection.visible=false;
      const oldClipping=r.clippingPlanes, oldShadow=r.shadowMap.autoUpdate;
      r.clippingPlanes=[this.reflectionPlane];r.shadowMap.autoUpdate=false;
      r.setRenderTarget(this.reflectionTarget);r.render(this.scene,c);
      r.clippingPlanes=oldClipping;r.shadowMap.autoUpdate=oldShadow;
      this.floor.visible=true;this.reflection.visible=true;
    }

    resize() {
      const size = this.renderer.getDrawingBufferSize(new T.Vector2());
      this.full.setSize(size.x,size.y);
      this.blurA.setSize(Math.max(1,Math.floor(size.x/4)),Math.max(1,Math.floor(size.y/4)));
      this.blurB.setSize(this.blurA.width,this.blurA.height);
      this.reflectionTarget.setSize(Math.min(800,Math.floor(size.x/2)),Math.min(500,Math.floor(size.y/2)));
      this.reflection.material.uniforms.texel.value.set(1/this.reflectionTarget.width,1/this.reflectionTarget.height);
    }

    update(dt,time,state,spark,echoes,velocity,yaw,nerve) {
      this.frameCount++;
      const now = performance.now();
      if (now - this.frameStart >= 1000) {
        this.frameRate.textContent = `${Math.round(this.frameCount * 1000 / (now - this.frameStart))} FPS`;
        this.frameCount = 0;
        this.frameStart = now;
      }
      if (!this.reducedMotion) {
        this.armillary.rotation.y = time * 0.08;
        this.dust.material.uniforms.time.value = time;
      }
      document.body.dataset.mode = state;
      this.composite.uniforms.time.value = this.reducedMotion ? 0 : time;
      this.hudTimer += dt;
      if (this.hudTimer < 0.08) return;
      this.hudTimer = 0;
      this.drawRadar(spark,echoes,yaw,time);
      const distance = Math.hypot(spark.position.x-this.player.position.x,spark.position.z-this.player.position.z);
      this.distanceEl.textContent = `${Math.round(distance)} m`;
      this.echoEl.textContent = `${String(echoes.length).padStart(2,'0')} ECHOES`;
      this.projected.copy(spark.position);
      this.projected.y += 2.7;
      this.projected.project(this.camera);
      const visible = state === 'play' && this.projected.z < 1 && Math.abs(this.projected.x)<0.88 && Math.abs(this.projected.y)<0.65;
      this.marker.style.display = visible ? 'flex' : 'none';
      if (visible) {
        this.marker.style.left = `${(this.projected.x*.5+.5)*100}%`;
        this.marker.style.top = `${(-this.projected.y*.5+.5)*100}%`;
      }
    }

    drawRadar(spark,echoes,yaw,time) {
      const g=this.rad, size=300, center=150, scale=3.3;
      g.clearRect(0,0,size,size);
      g.save();g.translate(center,center);
      g.strokeStyle='rgba(149,189,184,.17)';g.lineWidth=1;
      for(const r of [40,80,120]){g.beginPath();g.arc(0,0,r,0,Math.PI*2);g.stroke();}
      g.beginPath();g.moveTo(-126,0);g.lineTo(126,0);g.moveTo(0,-126);g.lineTo(0,126);g.stroke();
      g.save();g.rotate(this.reducedMotion?0:time*.28);
      g.strokeStyle='rgba(120,206,190,.28)';g.beginPath();g.moveTo(0,0);g.lineTo(0,-120);g.stroke();g.restore();
      for (const e of echoes) {
        g.strokeStyle='rgba(231,114,98,.3)';g.beginPath();
        e.path.forEach((p,i)=>{if(i%3!==0 && i!==e.path.length-1)return;const x=p.x*scale,y=p.z*scale;i===0?g.moveTo(x,y):g.lineTo(x,y);});g.stroke();
        const p=e.group?.position;
        if(p){g.fillStyle='#f18c76';g.beginPath();g.arc(p.x*scale,p.z*scale,3,0,Math.PI*2);g.fill();}
      }
      g.fillStyle='#f4c184';g.save();g.translate(spark.position.x*scale,spark.position.z*scale);g.rotate(Math.PI/4);g.fillRect(-3.5,-3.5,7,7);g.restore();
      g.translate(this.player.position.x*scale,this.player.position.z*scale);g.rotate(-yaw);
      g.fillStyle='#abeee0';g.beginPath();g.moveTo(0,-7);g.lineTo(5,5);g.lineTo(0,2);g.lineTo(-5,5);g.closePath();g.fill();g.restore();
    }

    render() {
      const r=this.renderer;
      if (!this.high) {r.setRenderTarget(null);r.render(this.scene,this.camera);return;}
      // Half-rate reflections retain motion while leaving GPU time for flight and ghosts.
      if (this.reflectionFrame++ % 2 === 0) this.updateReflection();
      r.setRenderTarget(this.full);r.render(this.scene,this.camera);
      this.quad.material=this.blur;
      this.blur.uniforms.source.value=this.full.texture;
      this.blur.uniforms.threshold.value=0.72;
      this.blur.uniforms.direction.value.set(1/this.blurA.width,0);
      r.setRenderTarget(this.blurA);r.render(this.postScene,this.postCamera);
      this.blur.uniforms.source.value=this.blurA.texture;
      this.blur.uniforms.threshold.value=0;
      this.blur.uniforms.direction.value.set(0,1/this.blurA.height);
      r.setRenderTarget(this.blurB);r.render(this.postScene,this.postCamera);
      this.quad.material=this.composite;
      r.setRenderTarget(null);r.render(this.postScene,this.postCamera);
    }
  };
})();
