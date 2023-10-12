// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as THREE from "three";
import { MeshBasicMaterial } from "three/src/materials/MeshBasicMaterial";

import { toNanoSec } from "@foxglove/rostime";
import { SettingsTreeAction, SettingsTreeFields } from "@foxglove/studio";
import type { RosValue } from "@foxglove/studio-base/players/types";
import { emptyPose } from "@foxglove/studio-base/util/Pose";
import { Label, LabelPool } from "@foxglove/three-text";

import { RosObject } from "../../../players/types";
import { BaseUserData, Renderable } from "../Renderable";
import { Renderer } from "../Renderer";
import { PartialMessage, PartialMessageEvent, SceneExtension } from "../SceneExtension";
import { SettingsTreeEntry } from "../SettingsManager";
import { rgbaToCssString, stringToRgb } from "../color";
import {
  normalizeVector3,
  normalizeColorRGBA,
  normalizeHeader,
  normalizePose,
  normalizeTime,
  normalizeTwist,
} from "../normalizeMessages";
import { LD_OBJ_LIST_DATATYPES, LDObjectList, LDObject } from "../ros";
import { BaseSettings } from "../settings";
import { topicIsConvertibleToSchema } from "../topicIsConvertibleToSchema";

export type LayerSettingsLDObjectList = BaseSettings & {
  frameId: string | undefined;
  bboxColor: string;
};

const DEFAULT_COLOR = { r: 124 / 255, g: 107 / 255, b: 1, a: 1 };
const DEFAULT_COLOR_STR = rgbaToCssString(DEFAULT_COLOR);
const DEFAULT_SETTINGS: LayerSettingsLDObjectList = {
  visible: false,
  frameId: undefined,
  bboxColor: DEFAULT_COLOR_STR,
};

export type LDObjectListUserData = BaseUserData & {
  topic: string;
  settings: LayerSettingsLDObjectList;
  objectList: LDObjectList;
  originalMessage: Record<string, RosValue> | undefined;
};

const tempVec3 = new THREE.Vector3();
const tempVec3_2 = new THREE.Vector3();
const tempMat4 = new THREE.Matrix4();
const tempQuat = new THREE.Quaternion();

// const LATE_RENDER_ORDER = 9999999;
const tempColor = { r: 0, g: 0, b: 0, a: 1 };

export class LDObjectListRenderable extends Renderable<LDObjectListUserData> {
  private mesh: THREE.InstancedMesh<THREE.BoxGeometry, MeshBasicMaterial>;
  private material = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
  private outlineGeometry: THREE.InstancedBufferGeometry;
  private outline: THREE.LineSegments;
  private geometry: THREE.BoxGeometry;
  private maxInstances: number;
  private sharedEdgesGeometry: THREE.EdgesGeometry<THREE.BufferGeometry>;
  private labels: Label[] = [];
  private labelPool: LabelPool;

  public override pickableInstances = true;

  public constructor(topic: string, renderer: Renderer, userData: LDObjectListUserData) {
    super(topic, renderer, userData);
    this.geometry = renderer.sharedGeometry
      .getGeometry(`${this.constructor.name}-object`, createObjGeometry)
      .clone() as THREE.BoxGeometry;
    this.maxInstances = 48;
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, this.maxInstances);
    this.mesh.count = 0;
    this.labelPool = renderer.labelPool;

    // outline
    this.sharedEdgesGeometry = renderer.sharedGeometry.getGeometry(
      `${this.constructor.name}-objectedges`,
      () => createObjEdgesGeometry(this.geometry),
    );
    this.outlineGeometry = new THREE.InstancedBufferGeometry().copy(this.sharedEdgesGeometry);
    this.outlineGeometry.setAttribute("instanceMatrix", this.mesh.instanceMatrix);
    this.outline = new THREE.LineSegments(this.outlineGeometry, renderer.instancedOutlineMaterial);
    this.outline.frustumCulled = false;
    this.outline.userData.picking = false;
    this.add(this.outline);
  }

  public override dispose(): void {
    super.dispose();
    this.mesh.dispose();
    this.geometry.dispose();
    this.material.dispose();
    this.outlineGeometry.dispose();
    for (const label of this.labels) {
      this.labelPool.release(label);
    }
  }

  // public override instanceDetails(instanceId: number): Record<string, RosValue> | undefined {
  //   const objList = this.userData.objectList;
  // }

  public updateLDObjectList(
    objectList: LDObjectList,
    originalMessage: RosObject | undefined,
    settings: LayerSettingsLDObjectList,
    receiveTime: bigint,
  ): void {
    this.geometry.dispose();
    this.mesh.dispose();
    const messageTime = toNanoSec(objectList.header.stamp);
    this.userData.receiveTime = receiveTime;
    this.userData.messageTime = messageTime;
    this.userData.frameId = objectList.header.frame_id;
    this.userData.objectList = objectList;
    this.userData.originalMessage = originalMessage;
    this.userData.settings = settings;
    let i = 0;
    for (const obj of objectList.objects) {
      // update bboxs
      this.mesh.setMatrixAt(
        i,
        tempMat4.compose(
          tempVec3.set(obj.pose.position.x, obj.pose.position.y, obj.pose.position.z),
          tempQuat.set(
            obj.pose.orientation.x,
            obj.pose.orientation.y,
            obj.pose.orientation.z,
            obj.pose.orientation.w,
          ),
          tempVec3_2.set(obj.dimensions.x, obj.dimensions.y, obj.dimensions.z),
        ),
      );
      // update labels
      const newLabel = this.labelPool.acquire();
      this.labels.push(newLabel);
      this.add(newLabel);
      this.labels[i]?.setText(obj.id.toString().concat("\n").concat(obj.class_label_pred));
      this.labels[i]?.position.set(
        obj.tracking_points.x - 1,
        obj.tracking_points.y,
        obj.tracking_points.z,
      );
      this.labels[i]?.setBillboard(true);
      this.labels[i]?.setSizeAttenuation(false);
      this.labels[i]?.setLineHeight(8);
      stringToRgb(tempColor, settings.bboxColor);
      this.labels[i]?.setColor(tempColor.r, tempColor.g, tempColor.b);
      this.labels[i]?.setBackgroundColor(0, 0, 0);
      //newLabel.renderOrder = LATE_RENDER_ORDER;
      i++;
    }
    this.mesh.count = i;
    this.outlineGeometry.dispose();
    this.outlineGeometry = new THREE.InstancedBufferGeometry().copy(this.sharedEdgesGeometry);
    this.outlineGeometry.instanceCount = i;
    this.outlineGeometry.setAttribute("instanceMatrix", this.mesh.instanceMatrix);
    this.renderer.instancedOutlineMaterial.color.set(settings.bboxColor);
    this.outline.geometry = this.outlineGeometry;
    if (i < this.labels.length) {
      for (const label of this.labels.splice(i)) {
        this.labelPool.release(label);
      }
    }
  }
}

export class LDObjectListScene extends SceneExtension<LDObjectListRenderable> {
  public constructor(renderer: Renderer) {
    super("ld.ld_object_list", renderer);
    renderer.addSchemaSubscriptions(LD_OBJ_LIST_DATATYPES, this.handleLDObjectList);
  }

  public override startFrame(
    currentTime: bigint,
    renderFrameId: string,
    fixedFrameId: string,
  ): void {
    // Set the `frameId` to use for `updatePose()`
    for (const renderable of this.renderables.values()) {
      renderable.userData.frameId = renderable.userData.settings.frameId ?? renderFrameId;
    }
    super.startFrame(currentTime, renderFrameId, fixedFrameId);
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
        bboxColor: { label: "Object Color", input: "rgba", value: config.bboxColor ?? DEFAULT_COLOR_STR },
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
      renderable.updateLDObjectList(
        renderable.userData.objectList,
        renderable.userData.originalMessage,
        renderable.userData.settings,
        renderable.userData.receiveTime,
      );
    }
  };

  private handleLDObjectList = (messageEvent: PartialMessageEvent<LDObjectList>): void => {
    const topic = messageEvent.topic;
    const objectList = normalizeLDObjectList(messageEvent.message);
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
        messageTime: toNanoSec(objectList.header.stamp),
        frameId: this.renderer.normalizeFrameId(objectList.header.frame_id),
        pose: emptyPose(),
        settingsPath: ["topics", topic],
        settings,
        topic,
        objectList,
        originalMessage: messageEvent.message as RosObject,
      });

      this.add(renderable);
      this.renderables.set(topic, renderable);
    }

    renderable.updateLDObjectList(
      objectList,
      messageEvent.message as RosObject,
      renderable.userData.settings,
      receiveTime,
    );
  };
}

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
  objects: (PartialMessage<LDObject> | undefined)[] | undefined,
): LDObject[] {
  if (!objects) {
    return [];
  }
  return objects.map(normalizeLDObject);
}

function normalizeLDObjectList(objectList: PartialMessage<LDObjectList>): LDObjectList {
  return {
    header: normalizeHeader(objectList.header),
    frame_number: objectList.frame_number ?? 0,
    objects: normalizeLDObjects(objectList.objects),
  };
}

function createObjGeometry(): THREE.BoxGeometry {
  const objGeometry = new THREE.BoxGeometry(1, 1, 1);
  return objGeometry;
}

function createObjEdgesGeometry(objGeometry: THREE.BoxGeometry): THREE.EdgesGeometry {
  const objEdgesGeometry = new THREE.EdgesGeometry(objGeometry);
  return objEdgesGeometry;
}
