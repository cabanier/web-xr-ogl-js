import { Texture } from "ogl";
import React, { useContext, useEffect, useRef, useState } from "react"
import { generateCheckmate } from "../../utils/ChekmateTexture"
import { EventContextForwarder } from "../EventContext"

export default function CanvasDebugFrameTexture ({width = 256, height = 256, step = 64, update = () => {}}) {
	const context = useContext(EventContextForwarder);

	const [image, setImage] = useState<HTMLCanvasElement>();

	const selfRef = useRef<Texture>();

	useEffect(()=>{
		let last = null;

		function onPointerOut(e) {
			last = null;
		}

		function onPointerMove({clientX, clientY, buttons}: PointerEvent) {
			const ctx = image?.getContext('2d');

			if (buttons <= 0 || !ctx) {
				last = null;
				return;
			}

			if (!last) {
				last = [clientX, clientY];
				return;
			}

			ctx.save();

			ctx.setLineDash([]);
			ctx.lineWidth = 5;
			ctx.strokeStyle = 'green';

			ctx.beginPath();

			ctx.moveTo(last[0], last[1]);
			ctx.lineTo(clientX, clientY);
			ctx.closePath();

			ctx.stroke();

			ctx.restore();

			last = [clientX, clientY];

			selfRef.current && (selfRef.current.needsUpdate = true);
		}

		function onPointerDown({clientX, clientY}: PointerEvent) {
			const ctx = image?.getContext('2d');

			if (!ctx) {
				return;
			}

			ctx.save();

			ctx.setLineDash([]);
			ctx.lineWidth = 5;
			ctx.strokeStyle = 'blue';

			ctx.beginPath();
			ctx.ellipse(clientX, clientY, 20, 20, 0, 0, Math.PI * 2);
			ctx.closePath();

			ctx.stroke();

			ctx.restore();

			selfRef.current && (selfRef.current.needsUpdate = true);
		}

		context.addEventListener('pointermove', onPointerMove, {passive: true});
		context.addEventListener('pointerdown', onPointerDown, {passive: true});
		context.addEventListener('pointerout', onPointerOut, {passive: true});
		context.addEventListener('pointerover', onPointerOut, {passive: true});

		return () => {
			context.removeEventListener('pointermove', onPointerMove);
			context.removeEventListener('pointerdown', onPointerDown);
			context.removeEventListener('pointerout', onPointerOut);
			context.removeEventListener('pointerover', onPointerOut);
		}
	}, [context, image])

	useEffect(() => {
		setImage(generateCheckmate(width, height, step));
	}, [width, height, step])

	useEffect(()=>{
		update && update();
	},[image])

	return <texture {...{image} as any} ref = {selfRef} attach = {'texture'}/>
}
