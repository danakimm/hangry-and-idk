const DIVIDER_WIDTH_DEGREES = 1;
const DIVIDER_COLOR = "rgba(23, 33, 29, 0.75)";

export type WheelBackgrounds = {
  sliceAngle: number;
  sliceStartAngle: number;
  dividerStartAngle: number;
  wheelBackground: string;
  dividerBackground: string;
};

export function buildWheelBackgrounds(colors: string[]): WheelBackgrounds {
  if (colors.length === 0) {
    return {
      sliceAngle: 0,
      sliceStartAngle: 0,
      dividerStartAngle: 0,
      wheelBackground: "transparent",
      dividerBackground: "none",
    };
  }

  const sliceAngle = 360 / colors.length;
  const sliceStartAngle = -sliceAngle / 2;
  const dividerStartAngle = sliceStartAngle - DIVIDER_WIDTH_DEGREES / 2;
  const stops = colors.map((color, index) => {
    const start = index * sliceAngle;
    const end = (index + 1) * sliceAngle;
    return `${color} ${start}deg ${end}deg`;
  });

  return {
    sliceAngle,
    sliceStartAngle,
    dividerStartAngle,
    wheelBackground: `conic-gradient(from ${sliceStartAngle}deg, ${stops.join(", ")})`,
    dividerBackground: `repeating-conic-gradient(from ${dividerStartAngle}deg, ${DIVIDER_COLOR} 0deg ${DIVIDER_WIDTH_DEGREES}deg, transparent ${DIVIDER_WIDTH_DEGREES}deg ${sliceAngle}deg)`,
  };
}
