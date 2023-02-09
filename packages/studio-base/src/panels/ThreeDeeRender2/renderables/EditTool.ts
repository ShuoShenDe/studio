// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import * as THREE from "three";

import { PickedRenderable } from "@foxglove/studio-base/panels/ThreeDeeRender2/Picker";

import { Renderable, BaseUserData } from "../Renderable";
import { Renderer } from "../Renderer";
import { SceneExtension } from "../SceneExtension";

type EditState = "idle" | "edit-cubic";
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

type EditEvent = { type: "foxglove.edit-start" } | { type: "foxglove.edit-end" };

export class EditTool extends SceneExtension<Renderable<BaseUserData>, EditEvent> {
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

  public selectedObject: PickedRenderable | undefined;
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
  public state: EditState = "idle";

  public constructor(renderer: Renderer) {
    super("foxglove.EditTool", renderer);
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

  public startEditing(): void {
    // eslint-disable-next-line no-restricted-syntax
    console.log("Edittoll selectedObject");
    // eslint-disable-next-line no-restricted-syntax
    console.log(this.selectedObject);
    this._setState("edit-cubic");
    this.circle1 = new THREE.Mesh(this.circleGeometry, this.circleMaterial);
    this.circle2 = new THREE.Mesh(this.circleGeometry, this.circleMaterial);
    this.circle3 = new THREE.Mesh(this.circleGeometry, this.circleMaterial);
    this.circle4 = new THREE.Mesh(this.circleGeometry, this.circleMaterial);
  }

  public stopEditing(): void {
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

  private _setState(state: EditState): void {
    this.state = state;
    switch (state) {
      case "idle":
        this.renderer.input.removeListener("click", this._handleClick);
        this.renderer.input.removeListener("mousemove", this._handleMouseMove);
        this.dispatchEvent({ type: "foxglove.edit-end" });
        break;
      case "edit-cubic":
        this.point1 = this.point2 = undefined;
        this.renderer.input.addListener("click", this._handleClick);
        this.renderer.input.addListener("mousemove", this._handleMouseMove);
        this.dispatchEvent({ type: "foxglove.edit-start" });
        break;
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
      case "edit-cubic":
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
      case "edit-cubic":
        // eslint-disable-next-line no-restricted-syntax
        console.log("edit-cubic");
        this.point1 = worldSpaceCursorCoords.clone();
        break;
    }
    this._render();
  };

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

    if (this.point1 && this.point2) {
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
