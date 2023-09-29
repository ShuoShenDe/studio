// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as THREE from "three";

import { toNanoSec } from "@foxglove/rostime";
import { SettingsTreeAction, SettingsTreeFields } from "@foxglove/studio";
import type { RosValue } from "@foxglove/studio-base/players/types";
import { DynamicBufferGeometry } from "@foxglove/studio-base/panels/ThreeDeeRender/DynamicBufferGeometry";
import { BaseUserData, Renderable } from "../Renderable";
import { Renderer } from "../Renderer";
import { PartialMessage, PartialMessageEvent, SceneExtension } from "../SceneExtension";
import { SettingsTreeEntry } from "../SettingsManager";
import { makeRgba, rgbaToCssString, stringToRgba } from "../color";
import { normalizeVector3, normalizeColorRGBA, normalizeHeader, normalizePose, normalizeTime, normalizeTwist } from "../normalizeMessages";
import {
  Marker,
  MarkerAction,
  MarkerType,
  LD_OBJ_LIST_DATATYPES,
  TIME_ZERO,
  LDObjectList,
  LDObject,
} from "../ros";
import { BaseSettings } from "../settings";
import { topicIsConvertibleToSchema } from "../topicIsConvertibleToSchema";
import { makePose } from "../transforms";
import { RenderableLineStrip } from "./markers/RenderableLineStrip";

export type LayerSettingsLDObjectList = BaseSettings & {
  lineWidth: number;
  color: string;
};

type Material = THREE.MeshBasicMaterial
type BBoxes = THREE.Mesh<DynamicBufferGeometry, Material>[];
export type bboxAtTime = { receiveTime: bigint; messageTime: bigint; bbox: BBoxes };

const DEFAULT_COLOR = { r: 124 / 255, g: 107 / 255, b: 1, a: 1 };
const DEFAULT_LINE_WIDTH = 0.1;

const DEFAULT_COLOR_STR = rgbaToCssString(DEFAULT_COLOR);

const DEFAULT_SETTINGS: LayerSettingsLDObjectList = {
  visible: false,
  lineWidth: DEFAULT_LINE_WIDTH,
  color: DEFAULT_COLOR_STR,
};

export type LDObjectListUserData = BaseUserData & {
  settings: LayerSettingsLDObjectList;
  topic: string;
  ldObjLists: LDObjectList;
//   ObjectsHistory: bboxAtTime;
};

export class LDObjectListRenderable extends Renderable<LDObjectListUserData> {
  public override dispose(): void {
    super.dispose();
  }

  public override details(): Record<string, RosValue> {
    return this.userData.ldObjLists;
  }
}

export class LDObjectLists extends SceneExtension<LDObjectListRenderable> {

  public constructor(renderer: Renderer) {
    super("ld.ld_object_lists", renderer);

    renderer.addSchemaSubscriptions(LD_OBJ_LIST_DATATYPES, this.handleLDObjectList);
  }

  public override settingsNodes(): SettingsTreeEntry[] {
    const configTopics = this.renderer.config.topics;
    const handler = this.handleSettingsAction;
    const entries: SettingsTreeEntry[] = [];
    for (const topic of this.renderer.topics ?? []) {
      if (!topicIsConvertibleToSchema(topic, LD_OBJ_LIST_DATATYPES)) {
        continue;
      }
      const config = (configTopics[topic.name] ?? {}) as Partial<LayerSettingsLDObjectList>;

      // prettier-ignore
      const fields: SettingsTreeFields = {
        lineWidth: { label: "Line Width", input: "number", min: 0, placeholder: String(DEFAULT_LINE_WIDTH), step: 0.005, precision: 3, value: config.lineWidth },
        color: { label: "Color", input: "rgba", value: config.color ?? DEFAULT_COLOR_STR },
      };

      entries.push({
        path: ["topics", topic.name],
        node: {
          label: topic.name,
          icon: "Cube",
          fields,
          visible: config.visible ?? DEFAULT_SETTINGS.visible,
          handler,
        },
      });
    }
    return entries;
  }

  public override handleSettingsAction = (action: SettingsTreeAction): void => {
    const path = action.payload.path;
    if (action.action !== "update" || path.length !== 3) {
      return;
    }

    this.saveSetting(path, action.payload.value);

    // Update the renderable
    const topicName = path[1]!;
    const renderable = this.renderables.get(topicName);
    if (renderable) {
      const settings = this.renderer.config.topics[topicName] as
        | Partial<LayerSettingsLDObjectList>
        | undefined;
      renderable.userData.settings = { ...DEFAULT_SETTINGS, ...settings };
      this._updateLDObjectListRenderable(
        renderable,
        renderable.userData.ldObjLists,
        renderable.userData.receiveTime,
      );
    }
  };

  private handleLDObjectList = (messageEvent: PartialMessageEvent<LDObjectList>): void => {
    // console.log(messageEvent);
    const topic = messageEvent.topic;
    const ldObjLists = normalizeLDObjectList(messageEvent.message);
    const receiveTime = toNanoSec(messageEvent.receiveTime);

    let renderable = this.renderables.get(topic);
    if (!renderable) {
       // Set the initial settings from default values merged with any user settings
      const userSettings = this.renderer.config.topics[topic] as
        | Partial<LayerSettingsLDObjectList>
        | undefined;
      const settings = { ...DEFAULT_SETTINGS, ...userSettings };

      renderable = new LDObjectListRenderable(topic, this.renderer, {
        receiveTime,
        messageTime: toNanoSec(ldObjLists.header.stamp),
        frameId: this.renderer.normalizeFrameId(ldObjLists.header.frame_id),
        pose: makePose(),
        settingsPath: ["topics", topic],
        settings,
        topic,
        ldObjLists,
      });

      this.add(renderable);
      this.renderables.set(topic, renderable);
    }

    this._updateLDObjectListRenderable(renderable, ldObjLists, receiveTime);
  };

  private _updateLDObjectListRenderable(
    renderable: LDObjectListRenderable,
    ldObjLists: LDObjectList,
    receiveTime: bigint,
  ): void {
    // const settings = renderable.userData.settings;

    renderable.userData.receiveTime = receiveTime;
    renderable.userData.messageTime = toNanoSec(ldObjLists.header.stamp);
    renderable.userData.frameId = this.renderer.normalizeFrameId(ldObjLists.header.frame_id);
    renderable.userData.ldObjLists = ldObjLists;

    this.remove(...this.children);
    for (const obj of renderable.userData.ldObjLists.objects){
        const {x, y, z} = obj.pose.position;
        const dim = obj.dimensions;
        const geometry = new THREE.BoxGeometry( dim.x, dim.y, dim.z);
        const material = new THREE.MeshBasicMaterial( { color: 0x00ff00 } );
        const cube = new THREE.Mesh( geometry, material );
        cube.position.set(x,y,z);
        this.add( cube );
    }



    // draw lines renzhou
    // const topic = renderable.userData.topic;
    // const linesMarker = createLineStripMarker(polygonStamped, settings);
    // if (!renderable.userData.lines) {
    //   renderable.userData.lines = new RenderableLineStrip(
    //     topic,
    //     linesMarker,
    //     receiveTime,
    //     this.renderer,
    //   );
    //   renderable.add(renderable.userData.lines);
    // } else {
    //   renderable.userData.lines.update(linesMarker, receiveTime);
    // }
  }
}

// function createLineStripMarker(
//   polygonStamped: PolygonStamped,
//   settings: LayerSettingsPolygon,
// ): Marker {
//   // Close the polygon
//   const points = [...polygonStamped.polygon.points];
//   if (points.length > 0) {
//     points.push(points[0]!);
//   }

//   const linesMarker: Marker = {
//     header: polygonStamped.header,
//     ns: "",
//     id: 0,
//     type: MarkerType.LINE_STRIP,
//     action: MarkerAction.ADD,
//     pose: makePose(),
//     scale: { x: settings.lineWidth, y: 1, z: 1 },
//     color: stringToRgba(makeRgba(), settings.color),
//     lifetime: TIME_ZERO,
//     frame_locked: true,
//     points,
//     colors: [],
//     text: "",
//     mesh_resource: "",
//     mesh_use_embedded_materials: false,
//   };
//   return linesMarker;
// }

function normalizeLDObject(object: PartialMessage<LDObject> | undefined): LDObject {
    return {
        header: normalizeHeader(object?.header),
        id: object?.id ?? 0,
        tracking_age: object?.tracking_age ?? 0,
        Age: normalizeTime(object?.Age),
        lifetime: normalizeTime(object?.lifetime),
        object_status: object?.object_status ?? "",
        confidence: object?.confidence ?? 0,
        color: normalizeColorRGBA(object?.color),
        pose_reliable: object?.pose_reliable ?? false,
        pose: normalizePose(object?.pose),
        pose_var: normalizeVector3(object?.pose_var),
        gps_pos: normalizeVector3(object?.gps_pos),
        gps_var: normalizeVector3(object?.gps_var),
        tracking_points: normalizeVector3(object?.tracking_points),
        tracking_point_type: object?.tracking_point_type ?? 0,
        jsk_pose: normalizePose(object?.jsk_pose),
        yaw: object?.yaw ?? 0,
        yaw_var: object?.yaw_var ?? 0,
        heading_angle: object?.heading_angle ?? 0,
        heading_angle_var: object?.heading_angle_var ?? 0,
        pitch: object?.pitch ?? 0,
        pitch_var: object?.pitch_var ?? 0,
        dimensions: normalizeVector3(object?.dimensions),
        dimensions_var: normalizeVector3(object?.dimensions_var),
        clustered_dimensions: normalizeVector3(object?.clustered_dimensions),
        velocity: normalizeTwist(object?.velocity),
        velocity_var: normalizeTwist(object?.velocity_var),
        abs_velocity: object?.abs_velocity ?? 0,
        abs_velocity_var: object?.abs_velocity_var ?? 0,
        rel_velocity: normalizeTwist(object?.rel_velocity),
        rel_velocity_var: normalizeTwist(object?.rel_velocity_var),
        rel_abs_velocity: object?.rel_abs_velocity ?? 0,
        rel_abs_velocity_var: object?.rel_abs_velocity_var ?? 0,
        acceleration: normalizeTwist(object?.acceleration),
        acceleration_var: normalizeTwist(object?.acceleration_var),
        abs_acceleration: object?.abs_acceleration ?? 0,
        abs_acceleration_var: object?.abs_acceleration_var ?? 0,
        rel_acceleration: normalizeTwist(object?.rel_acceleration),
        rel_acceleration_var: normalizeTwist(object?.rel_acceleration_var),
        rel_abs_acceleration: object?.rel_abs_acceleration ?? 0,
        rel_abs_acceleration_var: object?.rel_abs_acceleration_var ?? 0,
        lane_relation: object?.lane_relation ?? 0,
        visibility: object?.visibility ?? 0,
        solid_angle: object?.solid_angle ?? 0,
        reflectivity: object?.reflectivity ?? 0,
        occlusion: object?.occlusion ?? "",
        occlusion_l: object?.occlusion_l ?? "",
        occlusion_h: object?.occlusion_h ?? "",
        occlusion_w: object?.occlusion_w ?? "",
        occlusion_lowerpart: object?.occlusion_lowerpart ?? false,
        validity: object?.validity ?? false,
        has_sun: object?.has_sun ?? false,
        relation_type: object?.relation_type ?? 0,
        relation_id: object?.relation_id ?? 0,
        has_child: object?.has_child ?? false,
        class_label_true: object?.class_label_true ?? "",
        class_label_pred: object?.class_label_pred ?? "",
        target_added: object?.target_added ?? false,
        target_deleted: object?.target_deleted ?? false,
        subclass_label_true: object?.subclass_label_true ?? "",
        subclass_label_pred: object?.subclass_label_pred ?? "",
        behavior_state: object?.behavior_state ?? 0,
    };
}

function normalizeLDObjects(
    objects: (PartialMessage<LDObject> | undefined)[] | undefined): LDObject[] {
    if (!objects){
        return [];
    }
    return objects.map(normalizeLDObject);
    }

function normalizeLDObjectList(objectList: PartialMessage<LDObjectList>): LDObjectList {
    return{
        header: normalizeHeader(objectList.header),
        frame_number: objectList.frame_number ?? 0,
        objects: normalizeLDObjects(objectList.objects)
    };
}
