// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import * as THREE from "three";

import { Renderable, BaseUserData } from "../Renderable";
import { Renderer } from "../Renderer";
import { SceneExtension } from "../SceneExtension";

type DrawCuboidState = "idle" | "place-first-point" | "place-second-point";
// | "place-third-point"
// | "place-fourth-point"

/** A renderOrder value that should result in rendering after most/all other objects in the scene */
const LATE_RENDER_ORDER = 9999999;

/**
 * A material that interprets the input mesh coordinates in pixel space, regardless of the camera
 * perspective/zoom level.
 */
class FixedSizeMeshMaterial extends THREE.ShaderMaterial {
  public constructor({
    color,
    ...params
  }: { color: THREE.ColorRepresentation } & THREE.MaterialParameters) {
    super({
      ...params,
      vertexShader: /* glsl */ `
        #include <common>
        uniform vec2 canvasSize;
        void main() {
          vec4 mvPosition = modelViewMatrix * vec4(0., 0., 0., 1.);

          // Adapted from THREE.ShaderLib.sprite
          vec2 scale;
          scale.x = length(vec3(modelMatrix[0].xyz));
          scale.y = length(vec3(modelMatrix[1].xyz));

          gl_Position = projectionMatrix * mvPosition;

          // Add position after projection to maintain constant pixel size
          gl_Position.xy += position.xy / canvasSize * scale * gl_Position.w;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 color;
        void main() {
          gl_FragColor = vec4(color, 1.0);
        }
      `,
      uniforms: {
        canvasSize: { value: [0, 0] },
        color: { value: new THREE.Color(color).convertSRGBToLinear() },
      },
    });
  }
}

type DrawingEvent = { type: "foxglove.cuboid-start" } | { type: "foxglove.cuboid-end" };

export class DrawCuboidTool extends SceneExtension<Renderable<BaseUserData>, DrawingEvent> {
  private circleGeometry = new THREE.CircleGeometry(5, 16);
  private circleMaterial = new FixedSizeMeshMaterial({
    color: 0xff0000,
    depthTest: false,
    depthWrite: false,
  });
  private circle1 = new THREE.Mesh(this.circleGeometry, this.circleMaterial);
  private circle2 = new THREE.Mesh(this.circleGeometry, this.circleMaterial);
  private circle3 = new THREE.Mesh(this.circleGeometry, this.circleMaterial);
  private circle4 = new THREE.Mesh(this.circleGeometry, this.circleMaterial);

  private cuboidPositionAttribute = new THREE.Float32BufferAttribute([], 3);
  public cuboid = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshBasicMaterial({ color: 0x00ff00 }),
  );
  private cuboidOccluded = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshBasicMaterial({
      color: 0xff0000,
    }),
  );

  private point1NeedsUpdate = false;
  private point2NeedsUpdate = false;
  // private point3NeedsUpdate = false;
  // private point4NeedsUpdate = false;

  private point1?: THREE.Vector3;
  private point2?: THREE.Vector3;
  // private point3?: THREE.Vector3;
  // private point4?: THREE.Vector3;

  public state: DrawCuboidState = "idle";

  public constructor(renderer: Renderer) {
    super("foxglove.DrawCuboidTool", renderer);

    this.cuboid.userData.picking = false;
    this.cuboidOccluded.userData.picking = false;
    this.circle1.userData.picking = false;
    this.circle2.userData.picking = false;
    this.circle3.userData.picking = false;
    this.circle4.userData.picking = false;

    this.cuboidOccluded.renderOrder = LATE_RENDER_ORDER;
    this.circle1.renderOrder = LATE_RENDER_ORDER;
    this.circle2.renderOrder = LATE_RENDER_ORDER;
    this.circle3.renderOrder = LATE_RENDER_ORDER;
    this.circle4.renderOrder = LATE_RENDER_ORDER;

    this.cuboid.frustumCulled = false;
    this.cuboidOccluded.frustumCulled = false;
    this.cuboid.geometry.setAttribute("position", this.cuboidPositionAttribute);
    this.cuboidOccluded.geometry.setAttribute("position", this.cuboidPositionAttribute);

    this.circle1.visible = false;
    this.circle2.visible = false;
    this.circle3.visible = false;
    this.circle4.visible = false;

    this.add(this.circle1);
    this.add(this.circle2);
    this.add(this.circle3);
    this.add(this.circle4);

    this.add(this.cuboid);
    this.add(this.cuboidOccluded);
    this._setState("idle");
  }

  public override dispose(): void {
    super.dispose();
    this.circleGeometry.dispose();
    this.circleMaterial.dispose();

    this.cuboid.geometry.dispose();
    this.cuboid.material.dispose();
    this.cuboidOccluded.geometry.dispose();
    this.cuboidOccluded.material.dispose();
    this.renderer.input.removeListener("click", this._handleClick);
    this.renderer.input.removeListener("mousemove", this._handleMouseMove);
  }

  public startDrawing(): void {
    this._setState("place-first-point");
    this.circle1 = new THREE.Mesh(this.circleGeometry, this.circleMaterial);
    this.circle2 = new THREE.Mesh(this.circleGeometry, this.circleMaterial);
    this.circle3 = new THREE.Mesh(this.circleGeometry, this.circleMaterial);
    this.circle4 = new THREE.Mesh(this.circleGeometry, this.circleMaterial);
  }

  public stopDrawing(): void {
    this._setState("idle");
    this.point1 = this.point2 = undefined;
  }

  public override startFrame(
    currentTime: bigint,
    renderFrameId: string,
    fixedFrameId: string,
  ): void {
    super.startFrame(currentTime, renderFrameId, fixedFrameId);
    this.circleMaterial.uniforms.canvasSize!.value[0] = this.renderer.input.canvasSize.x;
    this.circleMaterial.uniforms.canvasSize!.value[1] = this.renderer.input.canvasSize.y;
  }

  private _setState(state: DrawCuboidState): void {
    this.state = state;
    switch (state) {
      case "idle":
        this.renderer.input.removeListener("click", this._handleClick);
        this.renderer.input.removeListener("mousemove", this._handleMouseMove);
        this.dispatchEvent({ type: "foxglove.cuboid-end" });
        break;
      case "place-first-point":
        this.point1 = this.point2 = undefined;
        this.renderer.input.addListener("click", this._handleClick);
        this.renderer.input.addListener("mousemove", this._handleMouseMove);
        this.dispatchEvent({ type: "foxglove.cuboid-start" });
        break;
      case "place-second-point":
        break;
      // case "place-third-point":
      //   break;
      // case "place-fourth-point":
      //   break;
    }
    this._render();
  }

  private _handleMouseMove = (
    _cursorCoords: THREE.Vector2,
    worldSpaceCursorCoords: THREE.Vector3 | undefined,
    _event: MouseEvent,
  ) => {
    if (!worldSpaceCursorCoords) {
      return;
    }
    switch (this.state) {
      case "idle":
        break;
      case "place-first-point":
        (this.point1 ??= new THREE.Vector3()).copy(worldSpaceCursorCoords);
        this.point1NeedsUpdate = true;
        break;
      case "place-second-point":
        (this.point2 ??= new THREE.Vector3()).copy(worldSpaceCursorCoords);
        this.point2NeedsUpdate = true;
        break;
      // case "place-third-point":
      //   (this.point3 ??= new THREE.Vector3()).copy(worldSpaceCursorCoords);
      //   this.point3NeedsUpdate = true;
      //   break;
      // case "place-fourth-point":
      //   (this.point4 ??= new THREE.Vector3()).copy(worldSpaceCursorCoords);
      //   this.point4NeedsUpdate = true;
      //   break;
    }
    this._render();
  };

  private _handleClick = (
    _cursorCoords: THREE.Vector2,
    worldSpaceCursorCoords: THREE.Vector3 | undefined,
    _event: MouseEvent,
  ) => {
    if (!worldSpaceCursorCoords) {
      return;
    }
    switch (this.state) {
      case "idle":
        break;
      case "place-first-point":
        // eslint-disable-next-line no-restricted-syntax
        console.log("place-first-point");
        this.point1 = worldSpaceCursorCoords.clone();
        this.point1NeedsUpdate = true;
        this._setState("place-second-point");
        break;
      case "place-second-point":
        // eslint-disable-next-line no-restricted-syntax
        console.log("place-second-point");
        this.point2 = worldSpaceCursorCoords.clone();
        this.point2NeedsUpdate = true;
        this._setState("idle");
        break;
      // case "place-third-point":
      //   // eslint-disable-next-line no-restricted-syntax
      //   console.log("place-third-point");
      //   this.point3 = worldSpaceCursorCoords.clone();
      //   this.point3NeedsUpdate = true;
      //   this._setState("place-fourth-point");
      //   break;
      // case "place-fourth-point":
      //   // eslint-disable-next-line no-restricted-syntax
      //   console.log("place-fourth-point");
      //   this.point4 = worldSpaceCursorCoords.clone();
      //   this.point4NeedsUpdate = true;
      //   this._setState("idle");
      //   break;
    }
    this._render();
  };

  private _createBox(poi1: THREE.Vector3, poi2: THREE.Vector3): THREE.Float32BufferAttribute {
    const p0: THREE.Vector3 = poi1;
    const p1: THREE.Vector3 = new THREE.Vector3(poi1.x, poi2.y, poi2.z);
    const p2: THREE.Vector3 = new THREE.Vector3(poi1.x, poi2.y, poi2.z + 1);
    const p3: THREE.Vector3 = new THREE.Vector3(poi1.x, poi1.y, poi1.z + 1);
    const p4: THREE.Vector3 = new THREE.Vector3(poi2.x, poi1.y, poi1.z);
    const p5: THREE.Vector3 = poi2;
    const p6: THREE.Vector3 = new THREE.Vector3(poi2.x, poi2.y, poi2.z + 1);
    const p7: THREE.Vector3 = new THREE.Vector3(poi2.x, poi1.y, poi1.z + 1);

    const p = [
      p0,
      p1,
      p3,
      p1,
      p2,
      p3,

      p4,
      p5,
      p7,
      p5,
      p6,
      p7,

      p0,
      p1,
      p4,
      p1,
      p5,
      p4,

      p3,
      p2,
      p7,
      p2,
      p6,
      p7,

      p0,
      p3,
      p4,
      p3,
      p7,
      p4,

      p1,
      p2,
      p5,
      p2,
      p6,
      p5,
    ];

    // eslint-disable-next-line prefer-const
    let pp: number[] = [];
    p.forEach((unit) => {
      pp.push(unit.x);
      pp.push(unit.y);
      pp.push(unit.z);
    });
    return new THREE.Float32BufferAttribute(pp, 3);
  }

  private _render() {
    if (this.point1) {
      this.circle1.visible = true;
      this.circle1.position.copy(this.point1);

      if (this.point1NeedsUpdate) {
        this.point1NeedsUpdate = false;
      }
    } else {
      this.circle1.visible = false;
    }

    if (this.point2) {
      this.circle2.visible = true;
      this.circle2.position.copy(this.point2);

      if (this.point2NeedsUpdate) {
        this.point2NeedsUpdate = false;
      }
    } else {
      this.circle2.visible = false;
    }

    // if (this.point3) {
    //   this.circle3.visible = true;
    //   this.circle3.position.copy(this.point3);
    //   if (this.point3NeedsUpdate) {
    //     this.cuboidPositionAttribute.setXYZ(3, this.point3.x, this.point3.y, this.point3.z);
    //     this.cuboidPositionAttribute.needsUpdate = true;
    //     this.point3NeedsUpdate = false;
    //   }
    // } else {
    //   this.circle3.visible = false;
    // }

    // if (this.point4) {
    //   this.circle4.visible = true;
    //   this.circle4.position.copy(this.point4);
    //   if (this.point4NeedsUpdate) {
    //     this.cuboidPositionAttribute.setXYZ(5, this.point4.x, this.point4.y, this.point4.z);
    //     this.cuboidPositionAttribute.needsUpdate = true;
    //     this.point3NeedsUpdate = false;
    //   } else {
    //     this.circle4.visible = false;
    //   }
    // }

    if (this.point1 && this.point2) {
      this.cuboidPositionAttribute = this._createBox(this.point1, this.point2);
      this.cuboid.geometry.setAttribute("position", this.cuboidPositionAttribute);
      this.cuboidOccluded.geometry.setAttribute("position", this.cuboidPositionAttribute);
      this.cuboidPositionAttribute.needsUpdate = true;
      this.cuboid.visible = true;
      this.cuboidOccluded.visible = true;
    } else {
      // this.cuboid.visible = false;
      // this.cuboidOccluded.visible = false;
    }

    this.renderer.queueAnimationFrame();
  }
}
