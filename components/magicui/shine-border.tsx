"use client";

import { cn } from "@/lib/utils";

type TColorProp = string | string[];

interface ShineBorderProps {
    borderRadius?: number;
    borderWidth?: number;
    duration?: number;
    color?: TColorProp;
    className?: string;
    children: React.ReactNode;
}

/**
 * @name Shine Border
 * @description It is an animated background border effect.
 * @param borderRadius The radius of the border.
 * @param borderWidth The width of the border.
 * @param duration The duration of the animation.
 * @param color The color of the border.
 * @param className The class name to be applied to the component
 * @param children The children to be rendered.
 */
export default function ShineBorder({
    borderRadius = 8,
    borderWidth = 1,
    duration = 14,
    color = "#000000",
    className,
    children,
}: ShineBorderProps) {
    return (
        <div
            style={
                {
                    "--border-radius": `${borderRadius}px`,
                } as React.CSSProperties
            }
            className={cn(
                "relative min-h-[60px] w-full rounded-[--border-radius] bg-white p-3 text-black dark:bg-black dark:text-white",
                className,
            )}
        >
            <div
                style={
                    {
                        "--border-width": `${borderWidth}px`,
                        "--border-radius": `${borderRadius}px`,
                        "--duration": `${duration}s`,
                        "--mask-linear-gradient": `linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)`,
                        "--background-radial-gradient": `radial-gradient(transparent,transparent, ${color instanceof Array ? color.join(",") : color
                            }, transparent, transparent)`,
                    } as React.CSSProperties
                }
                className={`before:bg-shine-size pointer-events-none absolute inset-0 size-full rounded-[--border-radius] p-[--border-width] will-change-[background-position] content-[''] before:absolute before:inset-[-100%] before:animate-shine before:bg-[image:var(--background-radial-gradient)] before:bg-[length:300%_300%] motion-safe:before:animate-shine`}
            />
            {children}
        </div>
    );
}
