"use client";

import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import type { MenuItem } from "../shared/contract.ts";
import { MIN_MENUS, SPIN_DURATION_MS } from "../shared/constants.ts";
import { buildWheelBackgrounds } from "./wheel-style.ts";

function getRandomIndex(length: number) {
  const values = crypto.getRandomValues(new Uint32Array(1));
  return Math.floor((values[0] / 2 ** 32) * length);
}

export type RouletteWheelHandle = {
  resetRotation: () => void;
};

type RouletteWheelProps = {
  menus: MenuItem[];
  onSpinStart?: () => void;
  onSpinComplete: (selected: MenuItem) => void;
};

const RouletteWheel = forwardRef<RouletteWheelHandle, RouletteWheelProps>(
  function RouletteWheel({ menus, onSpinStart, onSpinComplete }, ref) {
    const [rotation, setRotation] = useState(0);
    const [isSpinning, setIsSpinning] = useState(false);
    const rotationRef = useRef(0);

    const { sliceAngle, wheelBackground, dividerBackground } = useMemo(
      () => buildWheelBackgrounds(menus.map((menu) => menu.color)),
      [menus],
    );

    const resetRotation = useCallback(() => {
      rotationRef.current = 0;
      setRotation(0);
    }, []);

    useImperativeHandle(ref, () => ({ resetRotation }), [resetRotation]);

    const spin = useCallback(() => {
      if (isSpinning || menus.length < MIN_MENUS) return;

      const chosenIndex = getRandomIndex(menus.length);
      const currentAngle = ((rotationRef.current % 360) + 360) % 360;
      const alignment =
        ((360 - currentAngle - chosenIndex * sliceAngle) % 360 + 360) % 360;
      const nextRotation = rotationRef.current + 360 * 6 + alignment;

      rotationRef.current = nextRotation;
      setIsSpinning(true);
      setRotation(nextRotation);
      onSpinStart?.();

      window.setTimeout(() => {
        setIsSpinning(false);
        onSpinComplete(menus[chosenIndex]);
      }, SPIN_DURATION_MS);
    }, [isSpinning, menus, sliceAngle, onSpinStart, onSpinComplete]);

    return (
      <div className="wheel-stage">
        <div className="stage-label">
          <span>STEP 01</span>
          <strong>룰렛 돌리기</strong>
        </div>

        <div className="wheel-wrap">
          <div className="pointer" aria-hidden="true">
            <span />
          </div>
          <div
            className={`wheel ${isSpinning ? "is-spinning" : ""}`}
            style={{
              background: wheelBackground,
              transform: `rotate(${rotation}deg)`,
            }}
            aria-hidden="true"
          >
            <div className="wheel-lines" style={{ background: dividerBackground }} />
            {menus.map((menu, index) => {
              const angle = index * sliceAngle;
              const radians = (angle * Math.PI) / 180;
              const left = 50 + 34 * Math.sin(radians);
              const top = 50 - 34 * Math.cos(radians);
              return (
                <div
                  className="wheel-label"
                  key={menu.id}
                  style={{ left: `${left}%`, top: `${top}%` }}
                >
                  <span>{menu.emoji}</span>
                  <b>{menu.name}</b>
                </div>
              );
            })}
            <div className="wheel-center" />
          </div>
        </div>

        <button
          className="spin-button"
          type="button"
          onClick={spin}
          disabled={isSpinning || menus.length < MIN_MENUS}
        >
          <span>{isSpinning ? "고르는 중..." : "룰렛 돌리기"}</span>
          <span aria-hidden="true">→</span>
        </button>
        <p className="spin-hint">최소 2개, 최대 10개의 메뉴로 돌릴 수 있어요.</p>
      </div>
    );
  },
);

export default RouletteWheel;
