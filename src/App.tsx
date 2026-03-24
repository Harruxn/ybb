import React, { useEffect, useRef, useState } from 'react';

// Emojis for the game
const TRASH_EMOJIS = ['🗑️', '🛢️', '📦', '🥤', '📰', '🔋'];
const SATELLITE_EMOJIS = ['🛰️', '🛸', '🚀'];
const ALL_ITEMS = [...TRASH_EMOJIS, ...SATELLITE_EMOJIS];

interface GameItem {
  id: string;
  emoji: string;
  x: number;
  y: number;
  speed: number;
  isGrabbed: boolean;
  size: number;
}

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const incineratorRef = useRef<HTMLDivElement>(null);

  const [score, setScore] = useState(0);
  const [isLoaded, setIsLoaded] = useState(false);
  const [coreTemp, setCoreTemp] = useState(1450);

  // Mutable game state to avoid re-renders in the animation loop
  const gameState = useRef({
    items: [] as GameItem[],
    handPos: { x: 0, y: 0 },
    isPinching: false,
    grabbedItemId: null as string | null,
    lastSpawnTime: 0,
    score: 0, // Keep a ref copy for the loop
  });

  useEffect(() => {
    // Sync score ref with state for the UI
    gameState.current.score = score;
  }, [score]);

  useEffect(() => {
    let camera: any;
    let hands: any;
    let animationFrameId: number;

    const initMediaPipe = async () => {
      if (!videoRef.current || !canvasRef.current) return;

      // @ts-ignore - Loaded via CDN in index.html
      hands = new window.Hands({
        locateFile: (file: string) => {
          return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
        }
      });

      hands.setOptions({
        maxNumHands: 1,
        modelComplexity: 1,
        minDetectionConfidence: 0.7,
        minTrackingConfidence: 0.7
      });

      hands.onResults(onResults);

      // @ts-ignore - Loaded via CDN in index.html
      camera = new window.Camera(videoRef.current, {
        onFrame: async () => {
          if (videoRef.current) {
            await hands.send({ image: videoRef.current });
          }
        },
        width: 1280,
        height: 720
      });

      await camera.start();
      setIsLoaded(true);
      
      // Start game loop
      animationFrameId = requestAnimationFrame(gameLoop);
    };

    const onResults = (results: any) => {
      if (!canvasRef.current) return;
      const ctx = canvasRef.current.getContext('2d');
      if (!ctx) return;

      const width = canvasRef.current.width;
      const height = canvasRef.current.height;

      ctx.clearRect(0, 0, width, height);

      if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        const landmarks = results.multiHandLandmarks[0];
        
        // Landmark 4: Thumb tip, Landmark 8: Index finger tip
        const thumbTip = landmarks[4];
        const indexTip = landmarks[8];

        // Convert normalized coordinates to pixel coordinates
        // Note: MediaPipe coordinates are mirrored if the camera is mirrored.
        // We assume the video is mirrored via CSS (scaleX(-1)), so we mirror the X coordinate here.
        const x4 = (1 - thumbTip.x) * width;
        const y4 = thumbTip.y * height;
        const x8 = (1 - indexTip.x) * width;
        const y8 = indexTip.y * height;

        // Calculate distance in pixels
        const dx = x8 - x4;
        const dy = y8 - y4;
        const distance = Math.sqrt(dx * dx + dy * dy);

        // Calculate midpoint for the "cursor"
        const midX = (x4 + x8) / 2;
        const midY = (y4 + y8) / 2;

        gameState.current.handPos = { x: midX, y: midY };
        
        const wasPinching = gameState.current.isPinching;
        gameState.current.isPinching = distance < 30;

        if (gameState.current.isPinching && !wasPinching) {
          console.log('Đang gắp!');
        }

        // Draw Reticle
        ctx.save();
        ctx.translate(midX, midY);
        
        ctx.strokeStyle = gameState.current.isPinching ? '#ff525c' : '#7df4ff';
        ctx.lineWidth = 2;
        
        // Draw crosshair
        ctx.beginPath();
        ctx.moveTo(-15, 0); ctx.lineTo(-5, 0);
        ctx.moveTo(15, 0); ctx.lineTo(5, 0);
        ctx.moveTo(0, -15); ctx.lineTo(0, -5);
        ctx.moveTo(0, 15); ctx.lineTo(0, 5);
        ctx.stroke();

        // Draw pinch indicator circle
        if (gameState.current.isPinching) {
          ctx.beginPath();
          ctx.arc(0, 0, 20, 0, 2 * Math.PI);
          ctx.fillStyle = 'rgba(255, 82, 92, 0.2)';
          ctx.fill();
          ctx.stroke();
        }
        
        ctx.restore();
      } else {
        gameState.current.isPinching = false;
      }
    };

    const spawnItem = (timestamp: number) => {
      if (timestamp - gameState.current.lastSpawnTime > 1500) {
        const emoji = ALL_ITEMS[Math.floor(Math.random() * ALL_ITEMS.length)];
        const size = 40 + Math.random() * 20;
        const x = Math.random() * (window.innerWidth - size);
        
        gameState.current.items.push({
          id: Math.random().toString(36).substring(7),
          emoji,
          x,
          y: -size,
          speed: 2 + Math.random() * 3,
          isGrabbed: false,
          size
        });
        gameState.current.lastSpawnTime = timestamp;
      }
    };

    const gameLoop = (timestamp: number) => {
      spawnItem(timestamp);

      const state = gameState.current;
      const incineratorRect = incineratorRef.current?.getBoundingClientRect();

      // Handle Grabbing Logic
      if (state.isPinching && !state.grabbedItemId) {
        // Try to grab an item
        for (let i = state.items.length - 1; i >= 0; i--) {
          const item = state.items[i];
          const dx = state.handPos.x - (item.x + item.size / 2);
          const dy = state.handPos.y - (item.y + item.size / 2);
          const dist = Math.sqrt(dx * dx + dy * dy);
          
          if (dist < item.size) { // Collision radius
            item.isGrabbed = true;
            state.grabbedItemId = item.id;
            break; // Only grab one
          }
        }
      } else if (!state.isPinching && state.grabbedItemId) {
        // Release item
        const itemIndex = state.items.findIndex(i => i.id === state.grabbedItemId);
        if (itemIndex !== -1) {
          const item = state.items[itemIndex];
          item.isGrabbed = false;
          
          // Check if dropped in incinerator
          if (incineratorRect) {
            const itemCenterX = item.x + item.size / 2;
            const itemCenterY = item.y + item.size / 2;
            
            if (
              itemCenterX > incineratorRect.left &&
              itemCenterX < incineratorRect.right &&
              itemCenterY > incineratorRect.top &&
              itemCenterY < incineratorRect.bottom
            ) {
              // Scored!
              setScore(s => s + 10);
              setCoreTemp(t => Math.min(2000, t + 50)); // Visual effect
              state.items.splice(itemIndex, 1);
            }
          }
        }
        state.grabbedItemId = null;
      }

      // Update positions
      for (let i = state.items.length - 1; i >= 0; i--) {
        const item = state.items[i];
        
        if (item.isGrabbed) {
          item.x = state.handPos.x - item.size / 2;
          item.y = state.handPos.y - item.size / 2;
        } else {
          item.y += item.speed;
        }

        // Remove if off screen
        if (item.y > window.innerHeight) {
          state.items.splice(i, 1);
        }
      }

      // Force a re-render of the items container by updating a dummy state or directly manipulating DOM
      // For simplicity and performance in this specific setup, we'll update DOM directly
      const itemsContainer = document.getElementById('items-container');
      if (itemsContainer) {
        itemsContainer.innerHTML = '';
        state.items.forEach(item => {
          const el = document.createElement('div');
          el.style.position = 'absolute';
          el.style.left = `${item.x}px`;
          el.style.top = `${item.y}px`;
          el.style.fontSize = `${item.size}px`;
          el.style.userSelect = 'none';
          el.style.pointerEvents = 'none';
          el.style.filter = item.isGrabbed ? 'drop-shadow(0 0 10px #ff525c)' : 'drop-shadow(0 0 5px rgba(125, 244, 255, 0.5))';
          el.innerText = item.emoji;
          itemsContainer.appendChild(el);
        });
      }

      // Cool down core temp slowly
      setCoreTemp(t => Math.max(1450, t - 1));

      animationFrameId = requestAnimationFrame(gameLoop);
    };

    // Wait for scripts to load before initializing
    const checkScripts = setInterval(() => {
      // @ts-ignore
      if (window.Hands && window.Camera) {
        clearInterval(checkScripts);
        initMediaPipe();
      }
    }, 100);

    const handleResize = () => {
      if (canvasRef.current) {
        canvasRef.current.width = window.innerWidth;
        canvasRef.current.height = window.innerHeight;
      }
    };
    
    window.addEventListener('resize', handleResize);
    handleResize(); // Initial size

    return () => {
      clearInterval(checkScripts);
      cancelAnimationFrame(animationFrameId);
      if (camera) camera.stop();
      if (hands) hands.close();
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  return (
    <div className="relative w-full h-screen bg-[#131313] text-[#e5e2e1] overflow-hidden font-['Space_Grotesk']">
      
      {/* Webcam Background */}
      <video 
        ref={videoRef} 
        className="absolute inset-0 w-full h-full object-cover opacity-60 grayscale-[0.3] contrast-[1.2] -scale-x-100" 
        playsInline 
        autoPlay 
        muted
      />
      
      {/* AR Overlays */}
      <div className="absolute inset-0 pointer-events-none" style={{
        background: 'linear-gradient(to bottom, transparent 50%, rgba(125, 244, 255, 0.05) 50%)',
        backgroundSize: '100% 4px'
      }} />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,rgba(19,19,19,0.8)_100%)] pointer-events-none" />

      {/* Loading State */}
      {!isLoaded && (
        <div className="absolute inset-0 flex items-center justify-center z-50 bg-[#131313]/80 backdrop-blur-sm">
          <div className="text-[#7df4ff] text-xl font-bold tracking-widest animate-pulse flex flex-col items-center gap-4">
            <span className="material-symbols-outlined text-4xl animate-spin">radar</span>
            INITIALIZING KINETIC UPLINK...
          </div>
        </div>
      )}

      {/* Canvas for Reticle */}
      <canvas 
        ref={canvasRef} 
        className="absolute inset-0 z-20 pointer-events-none"
      />

      {/* Items Container (Updated via DOM manipulation for performance) */}
      <div id="items-container" className="absolute inset-0 z-10 pointer-events-none" />

      {/* Top Left: Score Display */}
      <div className="absolute top-8 left-8 z-30 pointer-events-none">
        <div className="bg-[#131313]/40 backdrop-blur-md border-l-4 border-[#7df4ff] p-6 shadow-[0_0_30px_rgba(125,244,255,0.1)]">
          <div className="text-[10px] text-[#7df4ff] font-bold tracking-[0.2em] mb-1 uppercase">Total Data Harvested</div>
          <div className="flex items-baseline gap-2">
            <span className="text-6xl font-black text-[#d3fbff] tracking-tighter">SCORE: {score}</span>
            <span className="text-xl text-[#7df4ff]/50">PTS</span>
          </div>
          <div className="mt-4 flex gap-1">
            <div className="h-1 w-12 bg-[#7df4ff]"></div>
            <div className="h-1 w-8 bg-[#7df4ff]/40"></div>
            <div className="h-1 w-4 bg-[#7df4ff]/20"></div>
          </div>
        </div>
      </div>

      {/* Bottom Center: Plasma Burner (Incinerator) */}
      <div 
        ref={incineratorRef}
        className="absolute bottom-8 left-1/2 -translate-x-1/2 z-30 w-96 pointer-events-none"
      >
        <div className="bg-[#131313]/60 backdrop-blur-xl p-6 shadow-[0_0_50px_rgba(255,82,92,0.15)] border-t-4 border-[#ff525c] text-center">
          <div className="flex justify-between items-end mb-4">
            <div className="text-left">
              <div className="text-[10px] text-[#ffb3b2] tracking-[0.2em] font-bold">CORE TEMP</div>
              <div className="text-xl font-black text-[#ffb3b2] italic">
                {coreTemp > 1800 ? 'CRITICAL' : 'NOMINAL'}
              </div>
            </div>
            <div>
              <span className="text-4xl font-black text-[#e5e2e1]">{Math.floor(coreTemp)}</span>
              <span className="text-sm font-bold text-[#ff525c] ml-1">°C</span>
            </div>
          </div>
          
          {/* Plasma Burner Visualizer */}
          <div className="relative h-16 w-full bg-[#0e0e0e] mb-4 overflow-hidden border border-[#5e3f3c]/30">
            <div 
              className="absolute inset-y-0 left-0 bg-gradient-to-r from-[#92001e] to-[#ffb3b2] shadow-[0_0_20px_rgba(255,82,92,0.5)] transition-all duration-300"
              style={{ width: `${Math.min(100, (coreTemp - 1000) / 10)}%` }}
            />
            {coreTemp > 1800 && (
              <div className="absolute inset-0 bg-[#ff525c]/20 animate-pulse" />
            )}
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-[#131313] font-black tracking-widest opacity-50 mix-blend-overlay text-2xl">INCINERATOR</span>
            </div>
          </div>
          
          <div className="flex justify-between items-center">
            <span className="text-[10px] font-bold text-[#e5e2e1]/60 tracking-widest uppercase">Plasma Burner (Lò đốt Plasma)</span>
            <div className="px-3 py-1 border border-[#ae8883] text-[#d3fbff] text-[10px] font-bold uppercase">
              VENTING: ACTIVE
            </div>
          </div>
        </div>
      </div>

      {/* Instructions Overlay (Bottom Left) */}
      <div className="absolute bottom-8 left-8 z-30 w-64 pointer-events-none">
        <div className="text-[10px] font-bold text-[#7df4ff] tracking-widest mb-4 uppercase">Mission Objectives</div>
        <ul className="space-y-3">
          <li className="flex items-center gap-3 bg-[#3a3939]/20 p-2 border-l-2 border-[#7df4ff]">
            <span className="material-symbols-outlined text-[#7df4ff] text-sm">pinch</span>
            <span className="text-xs font-medium text-[#d3fbff]">Pinch to Grab (Khoảng cách &lt; 30px)</span>
          </li>
          <li className="flex items-center gap-3 bg-[#3a3939]/20 p-2 border-l-2 border-[#ff525c]">
            <span className="material-symbols-outlined text-[#ff525c] text-sm">local_fire_department</span>
            <span className="text-xs font-medium text-[#ffb3b2]">Drop in Incinerator (+10 PTS)</span>
          </li>
        </ul>
      </div>

    </div>
  );
}
