// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { BufferGeometry } from "three/src/core/BufferGeometry";
import { EllipseCurve } from "three/src/extras/curves/EllipseCurve";
import { LineBasicMaterial } from "three/src/materials/LineBasicMaterial";
import { Group } from "three/src/objects/Group";
import { LineLoop } from "three/src/objects/LineLoop";

import type { Renderer } from "../../Renderer";
import { Marker } from "../../ros";
import { RenderableMarker } from "./RenderableMarker";

const DEFAULT_CIRCLEPTS_NUM = 32;
const DEFAULT_CIRCLE_COLOR = "#248eff";
const DEFAULT_CIRCLE_X = 0;
const DEFAULT_CIRCLE_Y = 0;

export class RenderableCircleList extends RenderableMarker {
  private geometries: BufferGeometry[]; //geometry
  private circles: LineLoop[]; //object3D
  private group: Group;
  private material: LineBasicMaterial;

  public constructor(
    topic: string,
    marker: Marker,
    receiveTime: bigint | undefined,
    renderer: Renderer,
  ) {
    super(topic, marker, receiveTime, renderer);
    this.geometries = [];
    this.circles = [];
    this.group = new Group();
    this.material = new LineBasicMaterial({ color: DEFAULT_CIRCLE_COLOR });

    const scale = marker.scale;
    this._setCircles(scale.x, scale.y, scale.z);
    this.add(this.group);
  }

  public override dispose(): void {
    this.geometries.forEach((items) => {
      items.dispose();
    });
    this.material.dispose();
  }

  public override update(newMarker: Marker, receiveTime: bigint | undefined): void {
    const prevScale = this.userData.marker.scale;
    super.update(newMarker, receiveTime);
    const scale = this.userData.marker.scale;

    if (prevScale !== scale) {
      this.geometries.forEach((item) => {
        item.dispose();
      });
      this.group.clear();
      this.geometries = [];
      this.circles = [];
      this._setCircles(scale.x, scale.y, scale.z);
    }
  }

  private _setCircles(minRadius: number, maxRadius: number, radiusStep: number): void {
    const radiuses: number[] = this._range(minRadius, maxRadius, radiusStep);
    for (let i: number = 0; i < radiuses.length; i++) {
      const r = radiuses[i];
      if (typeof r !== "undefined") {
        const curve = new EllipseCurve(
          DEFAULT_CIRCLE_X,
          DEFAULT_CIRCLE_Y,
          r,
          r,
          0.0,
          2.0 * Math.PI,
          false,
          0,
        );
        const curvePts = curve.getSpacedPoints(DEFAULT_CIRCLEPTS_NUM);
        const geometry = new BufferGeometry().setFromPoints(curvePts);
        const circle = new LineLoop(geometry, this.material);
        this.geometries.push(geometry);
        this.circles.push(circle);
        this.group.add(...this.circles);
      }
    }
  }

  private _range(start: number, stop: number | undefined, step: number | undefined): number[] {
    const result: number[] = [];
    let rangeStart = start;
    let rangeStop = stop;
    let rangeStep = step;
    if (typeof rangeStop === "undefined") {
      rangeStop = rangeStart;
      rangeStart = 0;
    }
    if (typeof rangeStep === "undefined") {
      rangeStep = 1;
    }
    if ((rangeStep > 0 && rangeStart >= rangeStop) || (rangeStep < 0 && rangeStart <= rangeStop)) {
      return result;
    }
    for (let i = rangeStart; rangeStep > 0 ? i < rangeStop : i > rangeStop; i += rangeStep) {
      result.push(i);
    }
    return result;
  }
}
