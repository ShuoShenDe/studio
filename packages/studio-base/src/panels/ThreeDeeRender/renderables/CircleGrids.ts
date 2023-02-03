// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { maxBy } from "lodash";

import Logger from "@foxglove/log";
import { SettingsTreeAction, SettingsTreeFields } from "@foxglove/studio";

import { BaseUserData, Renderable } from "../Renderable";
import { Renderer } from "../Renderer";
import { SceneExtension } from "../SceneExtension";
import { SettingsTreeEntry } from "../SettingsManager";
import { Marker, MarkerAction, MarkerType, TIME_ZERO } from "../ros";
import { CustomLayerSettings } from "../settings";
import { makePose } from "../transforms";
import { RenderableCircleList } from "./markers/RenderableCircleList";

const log = Logger.getLogger(__filename);

export type LayerSettingsCircleGrid = CustomLayerSettings & {
  layerId: "foxglove.CircleGrid";
  frameId: string | undefined;
  minSize: number;
  maxSize: number;
  step: number;
};

const LAYER_ID = "foxglove.CircleGrid";
const MIN_SIZE = 30;
const DEFAULT_SIZE = 100;
const MAX_SIZE = 300;
const DEFAULT_STEP = 20;
const MIN_STEP = 10;
const MAX_STEP = 40;

const DEFAULT_SETTINGS: LayerSettingsCircleGrid = {
  visible: true,
  frameLocked: true,
  label: "CircleGrid",
  instanceId: "invalid",
  layerId: LAYER_ID,
  frameId: undefined,
  minSize: MIN_SIZE,
  maxSize: DEFAULT_SIZE,
  step: DEFAULT_STEP,
};

export type CircleGridUserData = BaseUserData & {
  settings: LayerSettingsCircleGrid;
  circleList: RenderableCircleList;
};

export class CircleGridRenderable extends Renderable<CircleGridUserData> {
  public override dispose(): void {
    this.userData.circleList.dispose();
    super.dispose();
  }
}

export class CircleGrids extends SceneExtension<CircleGridRenderable> {
  public constructor(renderer: Renderer) {
    super("foxglove.CircleGrid", renderer);

    renderer.addCustomLayerAction({
      layerId: LAYER_ID,
      label: "Add Circle Grid",
      icon: "Grid",
      handler: this.handleAddGrid,
    });

    renderer.on("transformTreeUpdated", this.handleTransformTreeUpdated);

    // Load existing grid layers from the config
    for (const [instanceId, entry] of Object.entries(renderer.config.layers)) {
      if (entry?.layerId === LAYER_ID) {
        this._updateGrid(instanceId, entry as Partial<LayerSettingsCircleGrid>);
      }
    }
  }

  public override dispose(): void {
    this.renderer.off("transformTreeUpdated", this.handleTransformTreeUpdated);
    super.dispose();
  }

  public override removeAllRenderables(): void {
    // no-op
  }

  public override settingsNodes(): SettingsTreeEntry[] {
    const handler = this.handleSettingsAction;
    const entries: SettingsTreeEntry[] = [];
    for (const [instanceId, layerConfig] of Object.entries(this.renderer.config.layers)) {
      if (layerConfig?.layerId !== LAYER_ID) {
        continue;
      }

      const config = layerConfig as Partial<LayerSettingsCircleGrid>;

      // prettier-ignore
      const fields: SettingsTreeFields = {
        minSize: { label: "minSize", input: "number", min: MIN_SIZE, max: MAX_SIZE, step: 10, value: config.minSize, placeholder: String(MIN_SIZE) },
        maxSize: { label: "maxSize", input: "number", min: MIN_SIZE, max: MAX_SIZE, step: 10, value: config.maxSize, placeholder: String(DEFAULT_SIZE) },
        step: { label: "Step", input: "number", min: MIN_STEP, max: MAX_STEP, step: 10, value: config.step, placeholder: String(DEFAULT_STEP) },
      };

      entries.push({
        path: ["layers", instanceId],
        node: {
          label: config.label ?? "Grid",
          icon: "Grid",
          fields,
          visible: config.visible ?? DEFAULT_SETTINGS.visible,
          actions: [{ type: "action", id: "delete", label: "Delete" }],
          order: layerConfig.order,
          handler,
        },
      });

      // Create renderables for new grid layers
      if (!this.renderables.has(instanceId)) {
        this._updateGrid(instanceId, config);
      }
    }
    return entries;
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

  public override handleSettingsAction = (action: SettingsTreeAction): void => {
    const path = action.payload.path;

    // Handle menu actions (delete)
    if (action.action === "perform-node-action") {
      if (path.length === 2 && action.payload.id === "delete") {
        const instanceId = path[1]!;

        // Remove this instance from the config
        this.renderer.updateConfig((draft) => {
          delete draft.layers[instanceId];
        });

        // Remove the renderable
        this._updateGrid(instanceId, undefined);

        // Update the settings tree
        this.updateSettingsTree();
        this.renderer.updateCustomLayersCount();
      }
      return;
    }

    if (path.length !== 3) {
      return; // Doesn't match the pattern of ["layers", instanceId, field]
    }

    this.saveSetting(path, action.payload.value);

    const instanceId = path[1]!;
    const settings = this.renderer.config.layers[instanceId] as
      | Partial<LayerSettingsCircleGrid>
      | undefined;
    this._updateGrid(instanceId, settings);
  };

  private handleAddGrid = (instanceId: string): void => {
    log.info(`Creating ${LAYER_ID} layer ${instanceId}`);

    const config: LayerSettingsCircleGrid = { ...DEFAULT_SETTINGS, instanceId };

    // Add this instance to the config
    this.renderer.updateConfig((draft) => {
      const maxOrderLayer = maxBy(Object.values(draft.layers), (layer) => layer?.order);
      const order = 1 + (maxOrderLayer?.order ?? 0);
      draft.layers[instanceId] = { ...config, order };
    });

    // Add a renderable
    this._updateGrid(instanceId, config);

    // Update the settings tree
    this.updateSettingsTree();
  };

  private handleTransformTreeUpdated = (): void => {
    this.updateSettingsTree();
  };

  private _updateGrid(
    instanceId: string,
    settings: Partial<LayerSettingsCircleGrid> | undefined,
  ): void {
    let renderable = this.renderables.get(instanceId);

    // Handle deletes
    if (settings == undefined) {
      if (renderable != undefined) {
        renderable.userData.circleList.dispose();
        this.remove(renderable);
        this.renderables.delete(instanceId);
      }
      return;
    }

    const newSettings = { ...DEFAULT_SETTINGS, ...settings };
    if (!renderable) {
      renderable = this._createRenderable(instanceId, newSettings);
      //   renderable.userData.pose = xyzrpyToPose(newSettings.position, newSettings.rotation);
    }

    const prevSettings = renderable.userData.settings;
    const markersEqual =
      newSettings.minSize === prevSettings.minSize &&
      newSettings.maxSize === prevSettings.maxSize &&
      newSettings.step === prevSettings.step;

    renderable.userData.settings = newSettings;

    // If the marker settings changed, generate a new marker and update the renderable
    if (!markersEqual) {
      const marker = createMarker(newSettings);
      renderable.userData.circleList.update(marker, undefined);
    }
  }

  private _createRenderable(
    instanceId: string,
    settings: LayerSettingsCircleGrid,
  ): CircleGridRenderable {
    const marker = createMarker(settings);
    const circleListId = `${instanceId}:CIRCLE_LIST`;
    const circleList = new RenderableCircleList(circleListId, marker, undefined, this.renderer);
    const renderable = new CircleGridRenderable(instanceId, this.renderer, {
      receiveTime: 0n,
      messageTime: 0n,
      frameId: "", // This will be updated in `startFrame()`
      pose: makePose(),
      settingsPath: ["layers", instanceId],
      settings,
      circleList,
    });
    renderable.add(circleList);

    this.add(renderable);
    this.renderables.set(instanceId, renderable);
    return renderable;
  }
}

function createMarker(settings: LayerSettingsCircleGrid): Marker {
  const { minSize, maxSize, step } = settings;
  return {
    header: {
      frame_id: "", // unused, settings.frameId is used instead
      stamp: TIME_ZERO,
    },
    ns: "",
    id: 0,
    type: MarkerType.LINE_LIST,
    action: MarkerAction.ADD,
    pose: makePose(),
    scale: { x: minSize, y: maxSize, z: step },
    color: { r: 0, g: 0, b: 0, a: 0 },
    lifetime: TIME_ZERO,
    frame_locked: true,
    points: [],
    colors: [],
    text: "",
    mesh_resource: "",
    mesh_use_embedded_materials: false,
  };
}
