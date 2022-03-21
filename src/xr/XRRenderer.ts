import { Renderer } from "ogl";
import XRLayers from "webxr-layers-polyfill";

import type {
	IQuadLayerInit,
	XRCompositionLayer,
	XRFrame,
	XRInputSource,
	XRInputSourceArray,
	XRInputSourceEvent,
	XRLayer,
	XRReferenceSpace,
	XRReferenceSpaceType,
	XRSession,
	XRSessionInit,
	XRSessionMode,
	XRWebGLBinding,
	XRWebGLLayer,
	IXRCompositionLayerInit,
} from "webxr";
import { XRSessionLayers } from ".";
import { OGLQuadLayer, OGLXRLayer } from "./OGLXRLayer";
import { XRRenderTarget } from "./XRRenderTarget";
import type { XRInputTransform } from "./XRInputTransform";

/* Polyfill when needed */
new XRLayers();

function getXR() {
	return navigator.xr;
}
export interface ISessionRequest {
	mode?: XRSessionMode;
	space?: XRReferenceSpaceType;
	options?: XRSessionInit;
}

interface XRStateEventMap {
	xrend: CustomEvent<never>;
	xrstart: CustomEvent<XRState>;
	xrinputsourceschange: CustomEvent<XRInputSourceArray>;
}

export class XRState extends EventTarget {
	static layersSupport = false;

	context: XRRenderer;
	session: XRSessionLayers;
	space: XRReferenceSpace;
	layers: Array<XRCompositionLayer | XRWebGLLayer> = [];
	baseLayer: XRWebGLLayer | XRCompositionLayer = null;
	baseLayerTarget: XRRenderTarget;
	lastXRFrame: XRFrame = null;
	glBinding: XRWebGLBinding;

	constructor(context: XRRenderer) {
		super();

		this.context = context;

		this.onEnd          = this.onEnd.bind(this);
		this.onInputChanged = this.onInputChanged.bind(this);
	}

	async requestSession(
		context: XRRenderer,
		{
			mode = "immersive-vr",
			space = "local",
			options = {
				requiredFeatures: ["local",],
				optionalFeatures: ["layers"],
			},
		}: ISessionRequest = {}
	) {
		if (this.session) {
			this.end();
		}

		const session: XRSessionLayers = await getXR().requestSession(mode, options);

		XRState.layersSupport = !!session.renderState.layers;

		const refSpace = await session.requestReferenceSpace(space);

		this.init(session, refSpace);

		return this;
	}

	private init (session: XRSessionLayers, space: XRReferenceSpace) {
		if (this.session) {
			this.clear();
		}

		this.space = space;
		this.session = session;
		this.session.addEventListener("end", this.onEnd.bind(this));
		this.session.addEventListener(
			"inputsourceschange",
			this.onInputChanged.bind(this)
		);

		this.dispatchEvent(
			new CustomEvent("xrstart", {
				detail: this,
			})
		);
	}

	get active() {
		return !!this.session;
	}

	public addEventListener<T extends keyof XRStateEventMap>(
		type: T,
		listener: (this: XRState, ev: XRStateEventMap[T]) => any,
		options?: boolean | AddEventListenerOptions
	): void;

	public addEventListener(
		type: string,
		listener: (this: XRState, ev: Event) => any,
		options?: boolean | AddEventListenerOptions
	): void {
		super.addEventListener(type, listener, options);
	}

	onInputChanged(event: XRInputSourceEvent) {
		this.dispatchEvent(
			new CustomEvent("xrinputsourceschange", {
				detail: this.session?.inputSources || [],
			})
		);
	}

	onEnd() {
		this.clear();

		this.onInputChanged(null);
		this.dispatchEvent(new CustomEvent("xrend"));
	}

	get inputSources(): Array<XRInputSource & {viewTransfromNode: XRInputTransform}> {
		return this.session?.inputSources as any || [];
	}

	// called from layer binding for dropping layer from state
	/* internal*/
	onLayerDestroy(layer: XRCompositionLayer | XRWebGLLayer) {
		if (!XRState.layersSupport || !this.session) {
			return;
		}

		this.layers = this.layers.filter((l) => l !== layer);
		this.updateRenderState();
	}

	updateRenderState() {
		if (XRState.layersSupport) {
			this.session.updateRenderState({ layers: this.layers });
		} else {
			this.session.updateRenderState({
				baseLayer: this.baseLayer as XRWebGLLayer,
			});
		}
	}

	getLayer(
		gl: GLContext,
		type: "base" | "cube" | "quad" | "sphere" = "base",
		options: IXRCompositionLayerInit & Record<string, any> = { space: this.space, viewPixelHeight: 100, viewPixelWidth: 100 }
	): XRCompositionLayer | XRWebGLLayer {
		options = Object.assign(
			{},
			{ space: this.space, viewPixelHeight: 100, viewPixelWidth: 100 },
			options
		);

		if (
			!XRState.layersSupport &&
			(type !== "base" || this.layers.length > 1)
		) {
			console.warn("[XR] Only single base layer is supported!");
			return null;
		}

		let layer: XRCompositionLayer | XRWebGLLayer;

		if (!XRState.layersSupport) {
			layer = new self.XRWebGLLayer(this.session, gl);
			this.baseLayer = layer;
		} else if (!options) {
			throw new Error("Only base layer can miss options!");
		} else {
			this.glBinding =
				this.glBinding || new self.XRWebGLBinding(this.session, gl);

			switch (type) {
				case "base": {
					layer = this.glBinding.createProjectionLayer({});
					this.baseLayer = layer;
					this.baseLayerTarget = new XRRenderTarget(this.context);
					this.baseLayerTarget.ignoreDepthValue = layer.ignoreDepthValues;

					console.debug("Occure presentation layer", this.baseLayer);

					break;
				}
				case "quad": {
					layer = this.glBinding.createQuadLayer(
						options as IQuadLayerInit
					);
					break;
				}
				default:
					throw new Error("Unsuppoted yet:" + type);
			}
		}

		// push front
		this.layers.unshift(layer);

		this.updateRenderState();

		return layer;
	}

	requestAnimationFrame(callback) {
		if (!this.session) {
			throw new Error('Try to requiest anima frame on disabled XRState');
		}

		const loopid = this.session.requestAnimationFrame((time, frame) => {
			this.lastXRFrame = frame;

			callback(time, frame);

			this.lastXRFrame = null;
		});

		return () => {
			this.session?.cancelAnimationFrame(loopid);
		};
	}

	end() {
		if (!this.session) {
			return;
		}

		const session = this.session;

		this.clear();

		this.onInputChanged(null);

		session.end();
	}

	clear() {
		if (!this.session) {
			return;
		}

		this.session.removeEventListener('end', this.onEnd);
		this.session.removeEventListener('inputsourceschange', this.onInputChanged);

		for (const layer of this.layers as XRCompositionLayer[]) {
			layer.destroy && layer.destroy();
		}

		this.layers = [];
		this.session = null;
		this.space = null;

		this.baseLayerTarget?.destroy();
		(this.baseLayer as XRCompositionLayer)?.destroy?.();

		this.baseLayerTarget = null;
		this.baseLayer = null;
		this.glBinding = null;
	}
}

type TRafCallback = (time: number, frame?: XRFrame) => void;

interface OCULUS_multiview extends OVR_multiview2 {
	framebufferTextureMultisampleMultiviewOVR?: (
		target: GLenum,
		attachment: GLenum,
		texture: WebGLTexture | null,
		level: GLint,
		samples: GLsizei,
		baseViewIndex: GLint ,
		numViews: GLsizei) => void
}
export class XRRenderer extends Renderer {
	static layersCtors: Record<
		"cube" | "quad" | "sphere",
		new (...any: any[]) => OGLXRLayer
	> = {
		cube: null,
		sphere: null,
		quad: OGLQuadLayer,
	};

	readonly xr: XRState;
	readonly attrs: WebGLContextAttributes;

	layers: OGLXRLayer<XRCompositionLayer>[] = [];

	_rafCallbacks: Map<number, TRafCallback> = new Map();
	_calbackID: number = 0;
	_clearLoopDel: () => void = null;
	_multiview: OCULUS_multiview;
	_multiviewAA: boolean = false;

	constructor(options) {
		super(options);

		this.xr = new XRState(this);

		this._onLayerDestroy = this._onLayerDestroy.bind(this);
		this._internalLoop = this._internalLoop.bind(this);

		this.xr.addEventListener("xrend", this.onSessionLost.bind(this));
		this.xr.addEventListener("xrstart", this.onSessionStart.bind(this));

		this.attrs = this.gl.getContextAttributes();

		Object.values(XRRenderer.layersCtors).forEach((ctor: typeof OGLXRLayer) => {
			ctor && (ctor.context = this);
		});

		/*
		this._multiview = this.gl.getExtension('OCULUS_multiview');
		this._multiviewAA = !!this._multiview;
		this._multiview = this.gl.getExtension('OVR_multiview2');

		if (this._multiview) {
			console.debug('[MULTIVEW] ' + this.gl.getParameter(this._multiview.MAX_VIEWS_OVR));
		}
		*/
	}

	_internalLoop(time?: number, frame?: XRFrame) {
		const callbacks = [...this._rafCallbacks.values()];

		this._rafCallbacks.clear();

		callbacks.forEach((c) => c(time, frame));

		this._attachLoop();
	}

	_clearLoop() {
		this._clearLoopDel?.();
		this._clearLoopDel = null;
	}

	_attachLoop() {
		this._clearLoop();

		if (this.xr.active) {
			this._clearLoopDel = this.xr.requestAnimationFrame(
				this._internalLoop
			);
			return;
		}

		const id = window.requestAnimationFrame(this._internalLoop);

		this._clearLoopDel = () => {
			window.cancelAnimationFrame(id);
		};
	}

	/**
	 * @deprecated use layer constructor instead
	 * @param type
	 * @param options
	 * @returns
	 */
	createLayer<T extends XRCompositionLayer = XRCompositionLayer>(
		type: "cube" | "quad" | "sphere" = "quad",
		options: any = {}
	): OGLXRLayer<T> {
		if (!this.xr) {
			throw new Error("Layers can be requiested ONLY in XR mode");
		}

		const Ctor = XRRenderer.layersCtors[type];

		if (!Ctor) {
			return null;
		}

		const layer = new Ctor(options);

		return layer as OGLXRLayer<T, any>;
	}

	/**
	 * Try to bind virtyal layer to native layer when XR is enabled and layer supported
	 */
	bindNativeLayerTo(layer: OGLXRLayer): boolean {
		const {
			type, options
		} = layer;

		let nativeLayer: XRCompositionLayer;

		if (XRState.layersSupport) {

			options.space = this.xr.space;

			try {
				nativeLayer = this.xr.getLayer(
					this.gl,
					type as any,
					options
				) as XRCompositionLayer;
			} catch(e) {
				console.error('[LAYER Binding Error]', e);
			}
		}

		layer.bindLayer(nativeLayer);

		return !!nativeLayer;
	}

	registerLayer(layer: OGLXRLayer): number {
		if (this.layers.indexOf(layer) > -1) {
			this.layers.splice(this.layers.indexOf(layer), 1);
		}

		this.bindNativeLayerTo(layer);

		layer.onLayerDestroy = this._onLayerDestroy;

		return this.layers.unshift(layer);
	}

	/* called by layer internal */
	_onLayerDestroy(layer: OGLXRLayer, nativeOnly: boolean) {
		if (!nativeOnly) {
			this.layers = this.layers.filter((e) => layer !== e);
		}

		if (this.xr && layer.nativeLayer) {
			this.xr.onLayerDestroy(layer.nativeLayer);
		}
	}

	onSessionLost() {
		this._clearLoop();

		for (const layer of this.layers) {
			// clear refs to native
			layer.bindLayer(null);
		}

		// rerun render loop
		this._attachLoop();

		console.warn("XR Session end");
	}

	onSessionStart() {
		this._attachLoop();

		// must be, because we should render
		this.xr.getLayer(this.gl, "base");

		this.layers.forEach((l) => this.bindNativeLayerTo(l));
	}

	async requestXR(options?: ISessionRequest) {
		if (this.xr.active) {
			return Promise.resolve();
		}

		await this.gl.makeXRCompatible();

		this._clearLoop();

		try {
			await this.xr.requestSession(options);
		} finally {
			this._attachLoop();
		}

		return this.xr;
	}

	requestAnimationFrame(callback: TRafCallback) {
		const id = this._calbackID++;

		this._rafCallbacks.set(id, callback);

		if (!this._clearLoopDel) {
			this._attachLoop();
		}

		return id;
	}

	cancelAnimationFrame(id: number) {
		this._rafCallbacks.delete(id);
	}

	setViewportUnchecked({ width, height, x = 0, y = 0 }) {
		this.state.viewport.width = width;
		this.state.viewport.height = height;
		this.state.viewport.x = x;
		this.state.viewport.y = y;
		this.gl.viewport(x, y, width, height);
	}

	bind2DTextureDirect(texture: WebGLTexture) {
		this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
		this.state.textureUnits[this.state.activeTextureUnit] = -1;
	}

	renderXR(options) {
		const { xr, gl } = this;

		if (!xr || !xr.lastXRFrame || !xr.active) {
			return;
		}

		const camera = options.camera;

		const {
			lastXRFrame,
			space,
			baseLayer,
			glBinding,
			baseLayerTarget
		} = xr;

		const poses = lastXRFrame.getViewerPose(space);

		if (!poses) {
			return;
		}

		xr.inputSources.forEach((source) => source.viewTransfromNode?.update(xr));

		poses.views.forEach((view, i) => {
			const { projectionMatrix, transform } = view;
			const { position, orientation } = transform;

			let target;
			let viewport;

			if (baseLayer instanceof self.XRWebGLLayer) {
				viewport = baseLayer.getViewport(view);

				target = {
					target: gl.FRAMEBUFFER,
					buffer: baseLayer.framebuffer,
					width: viewport.width,
					height: viewport.height,
				};
			} else {
				const glSubImage = glBinding.getViewSubImage(
					baseLayer as XRCompositionLayer,
					view
				);

				viewport = glSubImage.viewport;
				target = baseLayerTarget;

				if (i === 0) {
					baseLayerTarget.attach(glSubImage, this.attrs.antialias);
				}
			}

			camera.projectionMatrix.copy(projectionMatrix);
			camera.position.set(position.x, position.y, position.z);
			camera.quaternion.set(
				orientation.x,
				orientation.y,
				orientation.z,
				orientation.w
			);

			camera.updateMatrixWorld();

			this.setViewportUnchecked(viewport);

			super.render({
				...options,
				camera,
				target,
				clear:
					i === 0 &&
					(options.clear != void 0 ? options.clear : this.autoClear),
			});
		});

		if (baseLayerTarget) {
			baseLayerTarget.blit();
		}

		// reset state, XRLyaer polyfill will corrupt state
		this.bindFramebuffer();

		this.layers.forEach((e) => {
			e.update(lastXRFrame);
		});
	}

	render(options) {
		// render to XR if not a target and XR mode
		if (!options.target && this.xr.active) {
			return this.renderXR(options);
		}


		this.layers.forEach((e) => {
			e.update(null);
		});

		super.render(options);
	}
}
