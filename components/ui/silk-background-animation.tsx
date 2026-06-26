"use client";

import React, { useEffect, useRef, useState } from "react";

type ComponentProps = {
  backgroundOnly?: boolean;
  children?: React.ReactNode;
};

export const Component = ({ backgroundOnly = false, children }: ComponentProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setIsLoaded(true), 300);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let time = 0;
    const speed = 0.02;
    const scale = 2;
    const noiseIntensity = 0.8;

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };

    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    const noise = (x: number, y: number) => {
      const G = 2.71828;
      const rx = G * Math.sin(G * x);
      const ry = G * Math.sin(G * y);
      return (rx * ry * (1 + x)) % 1;
    };

    const animate = () => {
      const { width, height } = canvas;

      const gradient = ctx.createLinearGradient(0, 0, width, height);
      gradient.addColorStop(0, "#1a1a1a");
      gradient.addColorStop(0.5, "#2a2a2a");
      gradient.addColorStop(1, "#1a1a1a");

      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);

      const imageData = ctx.createImageData(width, height);
      const data = imageData.data;

      for (let x = 0; x < width; x += 2) {
        for (let y = 0; y < height; y += 2) {
          const u = (x / width) * scale;
          const v = (y / height) * scale;

          const tOffset = speed * time;
          const texX = u;
          const texY = v + 0.03 * Math.sin(8.0 * texX - tOffset);

          const pattern =
            0.6 +
            0.4 *
              Math.sin(
                5.0 *
                  (texX +
                    texY +
                    Math.cos(3.0 * texX + 5.0 * texY) +
                    0.02 * tOffset) +
                  Math.sin(20.0 * (texX + texY - 0.1 * tOffset)),
              );

          const rnd = noise(x, y);
          const intensity = Math.max(0, pattern - (rnd / 15.0) * noiseIntensity);

          const r = Math.floor(123 * intensity);
          const g = Math.floor(116 * intensity);
          const b = Math.floor(129 * intensity);
          const a = 255;

          const index = (y * width + x) * 4;
          if (index < data.length) {
            data[index] = r;
            data[index + 1] = g;
            data[index + 2] = b;
            data[index + 3] = a;
          }
        }
      }

      ctx.putImageData(imageData, 0, 0);

      const overlayGradient = ctx.createRadialGradient(
        width / 2,
        height / 2,
        0,
        width / 2,
        height / 2,
        Math.max(width, height) / 2,
      );
      overlayGradient.addColorStop(0, "rgba(0, 0, 0, 0.1)");
      overlayGradient.addColorStop(1, "rgba(0, 0, 0, 0.4)");

      ctx.fillStyle = overlayGradient;
      ctx.fillRect(0, 0, width, height);

      time += 1;
      animationRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.removeEventListener("resize", resizeCanvas);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, []);

  return (
    <>
      <style>{`
        html, body {
          margin: 0;
          padding: 0;
          overflow-x: hidden;
          font-family: "Work Sans", ui-sans-serif, system-ui, sans-serif;
        }

        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translateY(2rem);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes fadeInUpDelay {
          from {
            opacity: 0;
            transform: translateY(1rem);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes fadeInCorner {
          from {
            opacity: 0;
            transform: translateY(-1rem);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .animate-fade-in-up {
          animation: fadeInUp 1s ease-out forwards;
        }

        .animate-fade-in-up-delay {
          animation: fadeInUpDelay 1s ease-out 0.3s forwards;
        }

        .animate-fade-in-corner {
          animation: fadeInCorner 1s ease-out 0.9s forwards;
        }

        .silk-canvas {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          z-index: 0;
        }
      `}</style>

      <div
        className={
          backgroundOnly
            ? "pointer-events-none fixed inset-0 z-0 h-screen w-full overflow-hidden bg-black"
            : "relative h-screen w-full overflow-hidden bg-black"
        }
      >
        <canvas ref={canvasRef} className="silk-canvas" />

        <div className="absolute inset-0 z-10 bg-gradient-to-b from-black/30 via-transparent to-black/50" />

        {children}

        {!backgroundOnly && (
          <>
            <div className="relative z-20 flex h-full items-center justify-center">
              <div className="px-8 text-center">
                <h1
                  className={`
                    text-6xl sm:text-8xl md:text-9xl lg:text-[12rem] xl:text-[14rem]
                    font-light tracking-[-0.05em] leading-none
                    text-white mix-blend-difference
                    opacity-0
                    ${isLoaded ? "animate-fade-in-up" : ""}
                  `}
                  style={{
                    textShadow: "0 0 40px rgba(255, 255, 255, 0.1)",
                  }}
                >
                  silk
                </h1>

                <div
                  className={`
                    mt-8 text-lg md:text-xl lg:text-2xl
                    font-extralight tracking-[0.2em] uppercase
                    text-gray-300/80 mix-blend-overlay
                    opacity-0
                    ${isLoaded ? "animate-fade-in-up-delay" : ""}
                  `}
                >
                  <span className="inline-block">flowing</span>
                  <span className="mx-4 text-gray-500">•</span>
                  <span className="inline-block">texture</span>
                  <span className="mx-4 text-gray-500">•</span>
                  <span className="inline-block">art</span>
                </div>
              </div>
            </div>

            <div
              className={`
                absolute top-8 left-8 z-30
                text-xs font-light tracking-widest uppercase
                text-gray-500/40 mix-blend-overlay
                opacity-0
                ${isLoaded ? "animate-fade-in-corner" : ""}
              `}
            >
              2025
            </div>
          </>
        )}
      </div>
    </>
  );
};
