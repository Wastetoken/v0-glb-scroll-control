"use client"

import type React from "react"
import { useEffect, useRef, useState, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Slider } from "@/components/ui/slider"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Upload, Download, RotateCcw, Eye, EyeOff, ChevronDown, ChevronUp, Plus, Trash2, Code } from "lucide-react"

interface ControlPoint {
  x: number
  y: number
  z: number
}

interface RotationKeyframe {
  progress: number // 0-1, position along path
  x: number
  y: number
  z: number
}

interface PathConfig {
  controlPoints: ControlPoint[]
  scrollLength: number
  positions: { x: number; y: number; z: number; scale: number }[]
  rotationKeyframes: RotationKeyframe[]
}

export default function ScrollControlPanel() {
  const [glbFile, setGlbFile] = useState<File | null>(null)
  const [glbUrl, setGlbUrl] = useState<string>("")
  const [showPath, setShowPath] = useState(true)
  const [minimized, setMinimized] = useState(false)
  const [modelLoaded, setModelLoaded] = useState(false)
  const [scrollProgress, setScrollProgress] = useState(0)
  const [pathConfig, setPathConfig] = useState<PathConfig>({
    controlPoints: [
      { x: 100, y: 300, z: 0 },
      { x: -100, y: -200, z: 0 },
      { x: 100, y: 200, z: 0 },
      { x: -100, y: -100, z: 0 },
    ],
    scrollLength: 3000,
    positions: [
      { x: 15, y: 10, z: 0, scale: 1 },
      { x: 80, y: 50, z: 0, scale: 1.5 },
      { x: 40, y: 85, z: 0, scale: 1 },
    ],
    rotationKeyframes: [
      { progress: 0, x: 0, y: 0, z: 0 },
      { progress: 0.5, x: 0, y: Math.PI, z: 0 },
      { progress: 1, x: 0, y: Math.PI * 2, z: 0 },
    ],
  })

  const heroSectionRef = useRef<HTMLDivElement>(null)
  const threeContainerRef = useRef<HTMLDivElement>(null)
  const threeSceneRef = useRef<any>(null)
  const glbModelRef = useRef<any>(null)
  const pathCacheRef = useRef<any>(null)
  const sortedKeyframesRef = useRef<RotationKeyframe[]>([])
  const targetProgressRef = useRef(0)
  const currentProgressRef = useRef(0)

  // Convert percentage positions to pixel positions (Three.js uses bottom-left origin)
  const getPixelPositions = useCallback(() => {
    const section = heroSectionRef.current
    if (!section) return []
    const width = section.offsetWidth
    const height = section.offsetHeight
    return pathConfig.positions.map((pos) => ({
      x: (pos.x / 100) * width,
      y: height - (pos.y / 100) * height, // Flip Y for Three.js
      z: pos.z,
      scale: pos.scale,
    }))
  }, [pathConfig.positions])

  // Convert percentage positions for SVG (top-left origin)
  const getSVGPixelPositions = useCallback(() => {
    const section = heroSectionRef.current
    if (!section) return []
    const width = section.offsetWidth
    const height = section.offsetHeight
    return pathConfig.positions.map((pos) => ({
      x: (pos.x / 100) * width,
      y: (pos.y / 100) * height, // No flip for SVG
      z: pos.z,
      scale: pos.scale,
    }))
  }, [pathConfig.positions])

  const getAbsoluteControlPoints = useCallback(
    (pixelPositions: any[]) => {
      const cps: any[] = []
      for (let i = 0; i < pixelPositions.length - 1; i++) {
        const cp1Idx = i * 2
        const cp2Idx = i * 2 + 1
        const anchor1 = pixelPositions[i]
        const anchor2 = pixelPositions[i + 1]

        if (pathConfig.controlPoints[cp1Idx]) {
          cps.push({
            x: anchor1.x + pathConfig.controlPoints[cp1Idx].x,
            y: anchor1.y + pathConfig.controlPoints[cp1Idx].y,
            z: pathConfig.controlPoints[cp1Idx].z,
          })
        }
        if (pathConfig.controlPoints[cp2Idx]) {
          cps.push({
            x: anchor2.x + pathConfig.controlPoints[cp2Idx].x,
            y: anchor2.y + pathConfig.controlPoints[cp2Idx].y,
            z: pathConfig.controlPoints[cp2Idx].z,
          })
        }
      }
      return cps
    },
    [pathConfig.controlPoints],
  )

  const buildPathString = useCallback(() => {
    const positions = getSVGPixelPositions()
    const controlPoints = getAbsoluteControlPoints(positions)
    if (positions.length < 2) return ""

    let pathString = `M${positions[0].x},${positions[0].y}`
    for (let i = 0; i < positions.length - 1; i++) {
      const cp1 = controlPoints[i * 2]
      const cp2 = controlPoints[i * 2 + 1]
      const nextPos = positions[i + 1]
      if (cp1 && cp2 && nextPos) {
        pathString += ` C${cp1.x},${cp1.y} ${cp2.x},${cp2.y} ${nextPos.x},${nextPos.y}`
      }
    }
    return pathString
  }, [getSVGPixelPositions, getAbsoluteControlPoints])

  // Interpolate rotation from keyframes
  const getRotationAtProgress = useCallback(
    (progress: number) => {
      const sorted = sortedKeyframesRef.current
      if (sorted.length === 0) return { x: 0, y: 0, z: 0 }

      // Find surrounding keyframes
      let before = sorted[0]
      let after = sorted[sorted.length - 1]

      for (let i = 0; i < sorted.length - 1; i++) {
        if (progress >= sorted[i].progress && progress <= sorted[i + 1].progress) {
          before = sorted[i]
          after = sorted[i + 1]
          break
        }
      }

      if (before.progress === after.progress) {
        return { x: before.x, y: before.y, z: before.z }
      }

      const t = (progress - before.progress) / (after.progress - before.progress)
      return {
        x: before.x + (after.x - before.x) * t,
        y: before.y + (after.y - before.y) * t,
        z: before.z + (after.z - before.z) * t,
      }
    },
    [],
  )

  // Pre-sort rotation keyframes when they change
  useEffect(() => {
    sortedKeyframesRef.current = [...pathConfig.rotationKeyframes].sort((a, b) => a.progress - b.progress)
  }, [pathConfig.rotationKeyframes])

  // Precompute path data when config or size changes
  useEffect(() => {
    if (!heroSectionRef.current) return
    const positions = getPixelPositions()
    const controlPoints = getAbsoluteControlPoints(positions)
    pathCacheRef.current = { positions, controlPoints }
  }, [pathConfig, getPixelPositions, getAbsoluteControlPoints])

  useEffect(() => {
    if (typeof window === "undefined") return

    let cleanup: (() => void) | undefined

    const initScene = async () => {
      const THREE = await import("three")
      const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js")
      const { DRACOLoader } = await import("three/examples/jsm/loaders/DRACOLoader.js")

      const section = heroSectionRef.current
      const threeContainer = threeContainerRef.current
      if (!section || !threeContainer) return

      const scene = new THREE.Scene()
      const camera = new THREE.OrthographicCamera(0, section.offsetWidth, 0, section.offsetHeight, 1, 2000)
      camera.position.z = 1000

      const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true })
      renderer.setSize(section.offsetWidth, section.offsetHeight)
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)) // Cap at 2x for performance
      renderer.setClearColor(0x000000, 0)
      threeContainer.appendChild(renderer.domElement)

      // WebGL context loss handling
      renderer.domElement.addEventListener("webglcontextlost", (e) => {
        e.preventDefault()
        console.warn("WebGL context lost")
      })

      const ambientLight = new THREE.AmbientLight(0xffffff, 1.0)
      scene.add(ambientLight)

      const directionalLight = new THREE.DirectionalLight(0xffffff, 1.2)
      directionalLight.position.set(200, 400, 300)
      scene.add(directionalLight)

      const backLight = new THREE.DirectionalLight(0x6666ff, 0.5)
      backLight.position.set(-100, -200, -100)
      scene.add(backLight)

      // Setup DRACO loader once for compressed models
      const dracoLoader = new DRACOLoader()
      dracoLoader.setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.6/")
      dracoLoader.setDecoderConfig({ type: "js" })

      const gltfLoader = new GLTFLoader()
      gltfLoader.setDRACOLoader(dracoLoader)

      threeSceneRef.current = { scene, camera, renderer, THREE, gltfLoader, dracoLoader }

      gltfLoader.load(
        "/assets/3d/duck.glb",
        (gltf) => {
          const model = gltf.scene
          const box = new THREE.Box3().setFromObject(model)
          const center = box.getCenter(new THREE.Vector3())
          const size = box.getSize(new THREE.Vector3())
          const maxDim = Math.max(size.x, size.y, size.z)
          const baseScale = 120 / maxDim

          model.position.sub(center.clone().multiplyScalar(baseScale))

          model.traverse((child: any) => {
            if (child.isMesh) {
              child.castShadow = true
              child.receiveShadow = true
              child.frustumCulled = false // Prevent popping when animating via code
            }
          })

          scene.add(model)
          glbModelRef.current = { model, baseScale }
          setModelLoaded(true)

          // Position at start
          const positions = getPixelPositions()
          if (positions[0]) {
            model.position.set(positions[0].x, positions[0].y, 0)
            model.scale.setScalar(baseScale * positions[0].scale)
          }
        },
        undefined,
        (error) => {
          console.error("Error loading default model:", error)
        },
      )

      function animate() {
        requestAnimationFrame(animate)
        renderer.render(scene, camera)
      }
      animate()

      const handleResize = () => {
        const width = section.offsetWidth
        const height = section.offsetHeight
        camera.left = 0
        camera.right = width
        camera.top = 0
        camera.bottom = height
        camera.updateProjectionMatrix()
        renderer.setSize(width, height)
        
        // Rebuild path cache with new dimensions
        const positions = getPixelPositions()
        const controlPoints = getAbsoluteControlPoints(positions)
        pathCacheRef.current = { positions, controlPoints }
      }
      window.addEventListener("resize", handleResize)

      cleanup = () => {
        window.removeEventListener("resize", handleResize)
        renderer.dispose()
        dracoLoader.dispose()
      }
    }

    initScene()

    return () => {
      cleanup?.()
    }
  }, [])

  useEffect(() => {
    if (typeof window === "undefined") return

    const handleScroll = () => {
      const section = heroSectionRef.current
      if (!section) return

      const rect = section.getBoundingClientRect()
      const scrollHeight = section.offsetHeight - window.innerHeight
      const scrolled = -rect.top
      const progress = Math.max(0, Math.min(1, scrolled / scrollHeight))

      setScrollProgress(progress)
      targetProgressRef.current = progress // Set target, don't update directly
    }

    window.addEventListener("scroll", handleScroll, { passive: true })
    handleScroll() // Initial position
    return () => window.removeEventListener("scroll", handleScroll)
  }, [])

  // Smooth animation loop using lerp for AAA motion quality
  useEffect(() => {
    if (!modelLoaded) return

    let animationFrameId: number

    const animate = () => {
      // Lerp toward target progress for smooth motion
      const current = currentProgressRef.current
      const target = targetProgressRef.current
      const newProgress = current + (target - current) * 0.08

      currentProgressRef.current = newProgress
      updateModelPosition(newProgress)

      animationFrameId = requestAnimationFrame(animate)
    }

    animationFrameId = requestAnimationFrame(animate)

    return () => {
      if (animationFrameId) cancelAnimationFrame(animationFrameId)
    }
  }, [modelLoaded, updateModelPosition])

  const updateModelPosition = useCallback(
    (progress: number) => {
      if (!glbModelRef.current || !threeSceneRef.current || !pathCacheRef.current) return

      const { model, baseScale } = glbModelRef.current
      const { positions, controlPoints } = pathCacheRef.current

      if (positions.length < 2) return

      const numSegments = positions.length - 1
      const segmentProgress = progress * numSegments
      const currentSegment = Math.min(Math.floor(segmentProgress), numSegments - 1)
      const t = segmentProgress - currentSegment

      const cp1Idx = currentSegment * 2
      const cp2Idx = currentSegment * 2 + 1

      if (!controlPoints[cp1Idx] || !controlPoints[cp2Idx]) return

      const p0 = positions[currentSegment]
      const p1 = controlPoints[cp1Idx]
      const p2 = controlPoints[cp2Idx]
      const p3 = positions[currentSegment + 1]

      // Cubic bezier formula
      const mt = 1 - t
      const mt2 = mt * mt
      const mt3 = mt2 * mt
      const t2 = t * t
      const t3 = t2 * t

      const x = mt3 * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t3 * p3.x
      const y = mt3 * p0.y + 3 * mt2 * t * p1.y + 3 * mt * t2 * p2.y + t3 * p3.y
      const z = mt3 * p0.z + 3 * mt2 * t * p1.z + 3 * mt * t2 * p2.z + t3 * p3.z

      const scale = p0.scale + (p3.scale - p0.scale) * t

      model.position.set(x, y, z)
      model.scale.setScalar(baseScale * scale) // Preserve base scale

      // Apply interpolated rotation
      const rotation = getRotationAtProgress(progress)
      model.rotation.set(rotation.x, rotation.y, rotation.z)
    },
    [getRotationAtProgress],
  )

  useEffect(() => {
    if (!glbFile || !threeSceneRef.current) return

    const loadModel = async () => {
      const { scene, gltfLoader, THREE } = threeSceneRef.current
      const url = URL.createObjectURL(glbFile)

      gltfLoader.load(
        url,
        (gltf: any) => {
          // Dispose old model properly
          if (glbModelRef.current?.model) {
            const oldModel = glbModelRef.current.model
            scene.remove(oldModel)
            
            // Dispose geometries and materials to prevent GPU memory leak
            oldModel.traverse((child: any) => {
              if (child.isMesh) {
                if (child.geometry) child.geometry.dispose()
                if (child.material) {
                  if (Array.isArray(child.material)) {
                    child.material.forEach((m: any) => m.dispose())
                  } else {
                    child.material.dispose()
                  }
                }
              }
            })
          }

          const model = gltf.scene
          const box = new THREE.Box3().setFromObject(model)
          const center = box.getCenter(new THREE.Vector3())
          const size = box.getSize(new THREE.Vector3())
          const maxDim = Math.max(size.x, size.y, size.z)
          const baseScale = 120 / maxDim

          model.position.sub(center.clone().multiplyScalar(baseScale))

          model.traverse((child: any) => {
            if (child.isMesh) {
              child.castShadow = true
              child.receiveShadow = true
              child.frustumCulled = false // Prevent popping when animating via code
            }
          })

          scene.add(model)
          glbModelRef.current = { model, baseScale }
          setModelLoaded(true)

          // Position at current scroll
          updateModelPosition(currentProgressRef.current)

          URL.revokeObjectURL(url)
        },
        undefined,
        (error: any) => {
          console.error("Error loading GLB:", error)
          URL.revokeObjectURL(url)
        },
      )
    }

    loadModel()
  }, [glbFile, updateModelPosition, scrollProgress])

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setGlbFile(file)
      setGlbUrl(file.name)
    }
  }

  const exportConfig = () => {
    const config = {
      ...pathConfig,
      fileName: glbFile?.name || "duck.glb",
      exportDate: new Date().toISOString(),
    }
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "scroll-path-config.json"
    a.click()
    URL.revokeObjectURL(url)
  }

  const exportImplementationCode = () => {
    const code = `// Generated Scroll Animation Implementation
// Copy this to your Next.js project
// Required: npm install three @types/three

"use client"

import { useEffect, useRef, useState } from "react"
import * as THREE from "three"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js"

const PATH_CONFIG = ${JSON.stringify(pathConfig, null, 2)}

export default function ScrollAnimation() {
  const containerRef = useRef<HTMLDivElement>(null)
  const sectionRef = useRef<HTMLDivElement>(null)
  const modelRef = useRef<{ model: THREE.Object3D; baseScale: number } | null>(null)
  const sceneRef = useRef<{ 
    scene: THREE.Scene
    camera: THREE.OrthographicCamera
    renderer: THREE.WebGLRenderer 
  } | null>(null)
  const pathCacheRef = useRef<any>(null)
  const sortedKeyframesRef = useRef<any[]>([])
  const targetProgressRef = useRef(0)
  const currentProgressRef = useRef(0)
  const [modelLoaded, setModelLoaded] = useState(false)

  // Helper: Convert percentage to pixel positions (Three.js bottom-left origin)
  const getPixelPositions = (width: number, height: number) => {
    return PATH_CONFIG.positions.map((pos) => ({
      x: (pos.x / 100) * width,
      y: height - (pos.y / 100) * height, // Flip Y for Three.js
      z: pos.z,
      scale: pos.scale,
    }))
  }

  // Helper: Get absolute control points
  const getAbsoluteControlPoints = (pixelPositions: any[]) => {
    const cps: any[] = []
    for (let i = 0; i < pixelPositions.length - 1; i++) {
      const cp1Idx = i * 2
      const cp2Idx = i * 2 + 1
      const anchor1 = pixelPositions[i]
      const anchor2 = pixelPositions[i + 1]

      if (PATH_CONFIG.controlPoints[cp1Idx]) {
        cps.push({
          x: anchor1.x + PATH_CONFIG.controlPoints[cp1Idx].x,
          y: anchor1.y + PATH_CONFIG.controlPoints[cp1Idx].y,
          z: PATH_CONFIG.controlPoints[cp1Idx].z,
        })
      }
      if (PATH_CONFIG.controlPoints[cp2Idx]) {
        cps.push({
          x: anchor2.x + PATH_CONFIG.controlPoints[cp2Idx].x,
          y: anchor2.y + PATH_CONFIG.controlPoints[cp2Idx].y,
          z: PATH_CONFIG.controlPoints[cp2Idx].z,
        })
      }
    }
    return cps
  }

  // Helper: Interpolate rotation from keyframes
  const getRotationAtProgress = (progress: number) => {
    const sorted = sortedKeyframesRef.current
    if (sorted.length === 0) return { x: 0, y: 0, z: 0 }
    
    let before = sorted[0]
    let after = sorted[sorted.length - 1]

    for (let i = 0; i < sorted.length - 1; i++) {
      if (progress >= sorted[i].progress && progress <= sorted[i + 1].progress) {
        before = sorted[i]
        after = sorted[i + 1]
        break
      }
    }

    if (before.progress === after.progress) {
      return { x: before.x, y: before.y, z: before.z }
    }

    const t = (progress - before.progress) / (after.progress - before.progress)
    return {
      x: before.x + (after.x - before.x) * t,
      y: before.y + (after.y - before.y) * t,
      z: before.z + (after.z - before.z) * t,
    }
  }

  // Pre-sort rotation keyframes once
  useEffect(() => {
    sortedKeyframesRef.current = [...PATH_CONFIG.rotationKeyframes].sort((a: any, b: any) => a.progress - b.progress)
  }, [])

  useEffect(() => {
    const section = sectionRef.current
    const container = containerRef.current
    if (!section || !container) return

    const width = section.offsetWidth
    const height = section.offsetHeight

    let cleanup: (() => void) | undefined

    // Setup Three.js scene
    const scene = new THREE.Scene()
    const camera = new THREE.OrthographicCamera(0, width, 0, height, 1, 2000)
    camera.position.z = 1000

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true })
    renderer.setSize(width, height)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)) // Cap at 2x for performance
    renderer.setClearColor(0x000000, 0)
    container.appendChild(renderer.domElement)

    // WebGL context loss handling
    renderer.domElement.addEventListener("webglcontextlost", (e) => {
      e.preventDefault()
      console.warn("WebGL context lost")
    })

    // Lighting
    scene.add(new THREE.AmbientLight(0xffffff, 1.0))
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2)
    dirLight.position.set(200, 400, 300)
    scene.add(dirLight)
    const backLight = new THREE.DirectionalLight(0x6666ff, 0.5)
    backLight.position.set(-100, -200, -100)
    scene.add(backLight)

    sceneRef.current = { scene, camera, renderer }

    // Setup DRACO loader once for compressed GLB files
    const dracoLoader = new DRACOLoader()
    dracoLoader.setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.6/")
    dracoLoader.setDecoderConfig({ type: "js" })

    // Load GLB model
    const gltfLoader = new GLTFLoader()
    gltfLoader.setDRACOLoader(dracoLoader)
    gltfLoader.load("${glbUrl || "/path/to/your/model.glb"}", (gltf) => {
      const model = gltf.scene
      const box = new THREE.Box3().setFromObject(model)
      const center = box.getCenter(new THREE.Vector3())
      const size = box.getSize(new THREE.Vector3())
      const maxDim = Math.max(size.x, size.y, size.z)
      const baseScale = 120 / maxDim
      
      model.position.sub(center.multiplyScalar(baseScale))
      
      model.traverse((child: any) => {
        if (child.isMesh) {
          child.castShadow = true
          child.receiveShadow = true
          child.frustumCulled = false // Prevent popping when animating via code
        }
      })
      
      scene.add(model)
      modelRef.current = { model, baseScale }
      setModelLoaded(true)

      // Initial position
      const positions = getPixelPositions(width, height)
      if (positions[0]) {
        model.position.set(positions[0].x, positions[0].y, 0)
        model.scale.setScalar(baseScale * positions[0].scale)
      }

      // Precompute path data
      const controlPoints = getAbsoluteControlPoints(positions)
      pathCacheRef.current = { positions, controlPoints }
    })

    // Animation loop
    function animate() {
      requestAnimationFrame(animate)
      renderer.render(scene, camera)
    }
    animate()

    // Handle resize
    const handleResize = () => {
      const w = section.offsetWidth
      const h = section.offsetHeight
      camera.left = 0
      camera.right = w
      camera.top = 0
      camera.bottom = h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)

      // Recompute path cache on resize
      const positions = getPixelPositions(w, h)
      const controlPoints = getAbsoluteControlPoints(positions)
      pathCacheRef.current = { positions, controlPoints }
    }
    window.addEventListener("resize", handleResize)

    // Cleanup
    cleanup = () => {
      window.removeEventListener("resize", handleResize)
      renderer.dispose()
      dracoLoader.dispose()
    }

    return cleanup
  }, [])

  useEffect(() => {
    const handleScroll = () => {
      const section = sectionRef.current
      if (!section) return

      const rect = section.getBoundingClientRect()
      const scrollHeight = section.offsetHeight - window.innerHeight
      const progress = Math.max(0, Math.min(1, -rect.top / scrollHeight))

      targetProgressRef.current = progress // Set target, animation loop handles update
    }

    window.addEventListener("scroll", handleScroll, { passive: true })
    handleScroll() // Initial call
    return () => window.removeEventListener("scroll", handleScroll)
  }, [])

  // Smooth animation loop using lerp for AAA motion quality
  useEffect(() => {
    if (!modelLoaded) return

    let animationFrameId: number

    const animate = () => {
      const modelData = modelRef.current
      const pathCache = pathCacheRef.current
      if (!modelData || !pathCache) return

      const { model, baseScale } = modelData
      const { positions, controlPoints } = pathCache

      // Lerp toward target progress
      const current = currentProgressRef.current
      const target = targetProgressRef.current
      const progress = current + (target - current) * 0.08
      currentProgressRef.current = progress

      if (positions.length < 2) return

      const numSegments = positions.length - 1
      const segmentProgress = progress * numSegments
      const currentSegment = Math.min(Math.floor(segmentProgress), numSegments - 1)
      const t = segmentProgress - currentSegment

      const cp1Idx = currentSegment * 2
      const cp2Idx = currentSegment * 2 + 1

      if (!controlPoints[cp1Idx] || !controlPoints[cp2Idx]) return

      const p0 = positions[currentSegment]
      const p1 = controlPoints[cp1Idx]
      const p2 = controlPoints[cp2Idx]
      const p3 = positions[currentSegment + 1]

      // Cubic bezier interpolation
      const mt = 1 - t
      const mt2 = mt * mt
      const mt3 = mt2 * mt
      const t2 = t * t
      const t3 = t2 * t

      const x = mt3 * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t3 * p3.x
      const y = mt3 * p0.y + 3 * mt2 * t * p1.y + 3 * mt * t2 * p2.y + t3 * p3.y
      const z = mt3 * p0.z + 3 * mt2 * t * p1.z + 3 * mt * t2 * p2.z + t3 * p3.z
      const scale = p0.scale + (p3.scale - p0.scale) * t

      model.position.set(x, y, z)
      model.scale.setScalar(baseScale * scale) // Preserve base scale

      // Apply rotation keyframes
      const rotation = getRotationAtProgress(progress)
      model.rotation.set(rotation.x, rotation.y, rotation.z)

      animationFrameId = requestAnimationFrame(animate)
    }

    animationFrameId = requestAnimationFrame(animate)

    return () => {
      if (animationFrameId) cancelAnimationFrame(animationFrameId)
    }
  }, [modelLoaded])

  return (
    <>
      <div 
        ref={sectionRef} 
        style={{ height: "${pathConfig.scrollLength}px", position: "relative" }}
      >
        {/* Your page content goes here */}
      </div>
      <div 
        ref={containerRef} 
        style={{ 
          position: "fixed", 
          inset: 0, 
          pointerEvents: "none", 
          zIndex: 10 
        }} 
      />
    </>
  )
}
`

    const blob = new Blob([code], { type: "text/plain" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "scroll-animation.tsx"
    a.click()
    URL.revokeObjectURL(url)
  }

  const importConfig = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onload = (event) => {
        try {
          const config = JSON.parse(event.target?.result as string)
          setPathConfig(config)
        } catch (error) {
          console.error("Error parsing config:", error)
        }
      }
      reader.readAsText(file)
    }
  }

  const updateControlPoint = (index: number, axis: "x" | "y" | "z", value: number) => {
    setPathConfig((prev) => ({
      ...prev,
      controlPoints: prev.controlPoints.map((cp, idx) => (idx === index ? { ...cp, [axis]: value } : cp)),
    }))
  }

  const updatePosition = (index: number, axis: "x" | "y" | "z" | "scale", value: number) => {
    setPathConfig((prev) => ({
      ...prev,
      positions: prev.positions.map((pos, idx) => (idx === index ? { ...pos, [axis]: value } : pos)),
    }))
  }

  const updateRotationKeyframe = (index: number, axis: "x" | "y" | "z" | "progress", value: number) => {
    setPathConfig((prev) => ({
      ...prev,
      rotationKeyframes: prev.rotationKeyframes.map((kf, idx) => (idx === index ? { ...kf, [axis]: value } : kf)),
    }))
  }

  const addRotationKeyframe = () => {
    const lastKf = pathConfig.rotationKeyframes[pathConfig.rotationKeyframes.length - 1]
    setPathConfig((prev) => ({
      ...prev,
      rotationKeyframes: [
        ...prev.rotationKeyframes,
        {
          progress: Math.min(lastKf.progress + 0.2, 1),
          x: 0,
          y: 0,
          z: 0,
        },
      ].sort((a, b) => a.progress - b.progress),
    }))
  }

  const removeRotationKeyframe = (index: number) => {
    if (pathConfig.rotationKeyframes.length <= 2) return
    setPathConfig((prev) => ({
      ...prev,
      rotationKeyframes: prev.rotationKeyframes.filter((_, idx) => idx !== index),
    }))
  }

  const addAnchorPoint = () => {
    setPathConfig((prev) => {
      const lastPos = prev.positions[prev.positions.length - 1]
      return {
        ...prev,
        positions: [...prev.positions, { x: 50, y: Math.min(lastPos.y + 15, 95), z: 0, scale: 1 }],
        controlPoints: [...prev.controlPoints, { x: 100, y: 150, z: 0 }, { x: -100, y: -100, z: 0 }],
      }
    })
  }

  const removeAnchorPoint = (index: number) => {
    if (pathConfig.positions.length <= 2) return

    setPathConfig((prev) => {
      const newPositions = prev.positions.filter((_, idx) => idx !== index)
      let newControlPoints = [...prev.controlPoints]
      if (index === 0) {
        newControlPoints = newControlPoints.slice(2)
      } else if (index === prev.positions.length - 1) {
        newControlPoints = newControlPoints.slice(0, -2)
      } else {
        const removeStart = (index - 1) * 2 + 1
        newControlPoints.splice(removeStart, 2)
      }

      return {
        ...prev,
        positions: newPositions,
        controlPoints: newControlPoints,
      }
    })
  }

  const resetToDefault = () => {
    setPathConfig({
      controlPoints: [
        { x: 100, y: 300, z: 0 },
        { x: -100, y: -200, z: 0 },
        { x: 100, y: 200, z: 0 },
        { x: -100, y: -100, z: 0 },
      ],
      scrollLength: 3000,
      positions: [
        { x: 15, y: 10, z: 0, scale: 1 },
        { x: 80, y: 50, z: 0, scale: 1.5 },
        { x: 40, y: 85, z: 0, scale: 1 },
      ],
      rotationKeyframes: [
        { progress: 0, x: 0, y: 0, z: 0 },
        { progress: 0.5, x: 0, y: Math.PI, z: 0 },
        { progress: 1, x: 0, y: Math.PI * 2, z: 0 },
      ],
    })
  }

  const svgPositions = getSVGPixelPositions()
  const svgControlPoints = getAbsoluteControlPoints(svgPositions)

  return (
    <div className="relative min-h-screen bg-neutral-950">
      {/* Hero Section */}
      <div className="h-screen flex flex-col items-center justify-center px-4 bg-gradient-to-b from-neutral-900 to-neutral-950">
        <h1 className="text-2xl sm:text-4xl md:text-5xl font-bold text-center mb-4 text-white text-balance">
          3D Scroll Path Designer Pro
        </h1>
        <p className="text-sm sm:text-base text-neutral-400 text-center max-w-xl mb-8 px-4">
          Professional-grade scroll animation designer with rotation keyframes, accurate coordinate systems, and
          production-ready code export.
        </p>
        <div className="flex items-center gap-2 text-neutral-500">
          <ChevronDown className="w-5 h-5 animate-bounce" />
          <span className="text-sm">Scroll to see animation</span>
        </div>
      </div>

      {/* Main Scroll Section */}
      <div ref={heroSectionRef} className="relative bg-neutral-950" style={{ height: `${pathConfig.scrollLength}px` }}>
        {/* Anchor position indicators */}
        {pathConfig.positions.map((pos, idx) => (
          <div
            key={idx}
            className="absolute border-2 border-dashed border-rose-500/40 rounded-lg flex items-center justify-center text-xs text-rose-400/60 pointer-events-none"
            style={{
              left: `${pos.x}%`,
              top: `${pos.y}%`,
              width: `${80 + idx * 40}px`,
              height: `${80 + idx * 40}px`,
              transform: "translate(-50%, -50%)",
            }}
          >
            P{idx + 1}
          </div>
        ))}

        {/* Three.js container */}
        <div ref={threeContainerRef} className="absolute inset-0 pointer-events-none" style={{ zIndex: 20 }} />

        {/* SVG Path Visualization */}
        {showPath && (
          <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 15 }}>
            {/* Handle lines from anchors to control points */}
            {svgControlPoints.map((cp, idx) => {
              const segmentIdx = Math.floor(idx / 2)
              const isFirstCP = idx % 2 === 0
              const anchor = svgPositions[isFirstCP ? segmentIdx : segmentIdx + 1]
              if (!anchor) return null
              return (
                <line
                  key={`handle-${idx}`}
                  x1={anchor.x}
                  y1={anchor.y}
                  x2={cp.x}
                  y2={cp.y}
                  stroke="#22c55e"
                  strokeWidth="1.5"
                  strokeDasharray="6,4"
                  opacity="0.6"
                />
              )
            })}

            {/* Main bezier path */}
            <path d={buildPathString()} stroke="#f43f5e" strokeWidth="3" fill="none" opacity="0.9" />

            {/* Control point circles */}
            {svgControlPoints.map((cp, idx) => (
              <g key={`cp-${idx}`}>
                <circle cx={cp.x} cy={cp.y} r="8" fill="#22c55e" stroke="white" strokeWidth="2" />
                <text x={cp.x + 12} y={cp.y - 8} fill="#22c55e" fontSize="11" fontWeight="bold">
                  CP{idx + 1}
                </text>
              </g>
            ))}

            {/* Anchor point circles */}
            {svgPositions.map((pos, idx) => (
              <g key={`anchor-${idx}`}>
                <circle cx={pos.x} cy={pos.y} r="10" fill="#f43f5e" stroke="white" strokeWidth="2" />
                <text x={pos.x + 14} y={pos.y - 10} fill="#f43f5e" fontSize="12" fontWeight="bold">
                  P{idx + 1}
                </text>
              </g>
            ))}
          </svg>
        )}

        {/* Progress indicator */}
        <div className="fixed bottom-4 left-4 bg-black/80 px-3 py-2 rounded-lg text-xs text-white z-50">
          Progress: {(scrollProgress * 100).toFixed(0)}%
        </div>
      </div>

      {/* End Section */}
      <div className="h-screen flex flex-col items-center justify-center px-4 bg-gradient-to-b from-neutral-950 to-neutral-900">
        <h2 className="text-xl sm:text-3xl font-bold text-center mb-4 text-white">Scroll Back Up</h2>
        <ChevronUp className="w-6 h-6 animate-bounce text-neutral-400" />
      </div>

      {/* Control Panel */}
      <div
        className={`fixed top-2 left-2 right-2 sm:top-4 sm:left-auto sm:right-4 bg-neutral-900/95 backdrop-blur-sm border border-neutral-700 rounded-lg shadow-2xl transition-all duration-300 overflow-hidden z-50 ${
          minimized ? "w-auto sm:w-auto" : "sm:w-80 max-h-[85vh] overflow-y-auto"
        }`}
      >
        <div className="p-3">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-bold text-white">{minimized ? "Controls" : "Path Designer Pro"}</h2>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setMinimized(!minimized)}
              className="h-7 w-7 text-neutral-400 hover:text-white"
            >
              {minimized ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            </Button>
          </div>

          {!minimized && (
            <div className="space-y-3">
              {/* GLB Upload */}
              <Card className="p-2 bg-neutral-800 border-neutral-700">
                <Label className="text-xs font-semibold mb-2 block text-neutral-300">3D Model</Label>
                <input type="file" accept=".glb,.gltf" onChange={handleFileUpload} className="hidden" id="glb-upload" />
                <label htmlFor="glb-upload">
                  <Button
                    variant="outline"
                    className="w-full text-xs h-8 bg-neutral-700 border-neutral-600 hover:bg-neutral-600"
                    asChild
                  >
                    <span>
                      <Upload className="mr-2 h-3 w-3" />
                      {glbFile ? glbFile.name.slice(0, 18) : "Upload GLB (using duck)"}
                    </span>
                  </Button>
                </label>
              </Card>

              {/* Export/Import Buttons */}
              <div className="grid grid-cols-2 gap-2">
                <Button
                  onClick={exportConfig}
                  variant="outline"
                  size="sm"
                  className="text-xs h-8 bg-neutral-800 border-neutral-600"
                >
                  <Download className="mr-1 h-3 w-3" />
                  Config
                </Button>
                <Button
                  onClick={exportImplementationCode}
                  size="sm"
                  className="text-xs h-8 bg-emerald-600 hover:bg-emerald-700"
                >
                  <Code className="mr-1 h-3 w-3" />
                  Export Code
                </Button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <label className="contents">
                  <input type="file" accept=".json" onChange={importConfig} className="hidden" id="import-config" />
                  <Button variant="outline" size="sm" className="text-xs h-8 bg-neutral-800 border-neutral-600" asChild>
                    <span>
                      <Upload className="mr-1 h-3 w-3" />
                      Import
                    </span>
                  </Button>
                </label>
                <Button
                  onClick={resetToDefault}
                  variant="outline"
                  size="sm"
                  className="text-xs h-8 bg-neutral-800 border-neutral-600"
                >
                  <RotateCcw className="mr-1 h-3 w-3" />
                  Reset
                </Button>
              </div>

              <Button
                onClick={() => setShowPath(!showPath)}
                variant="outline"
                size="sm"
                className="w-full text-xs h-8 bg-neutral-800 border-neutral-600"
              >
                {showPath ? <EyeOff className="mr-1 h-3 w-3" /> : <Eye className="mr-1 h-3 w-3" />}
                {showPath ? "Hide Path" : "Show Path"}
              </Button>

              {/* Scroll Length */}
              <Card className="p-2 bg-neutral-800 border-neutral-700">
                <Label className="text-xs font-semibold mb-2 block text-neutral-300">Scroll Length</Label>
                <div className="flex gap-2 items-center">
                  <Slider
                    value={[pathConfig.scrollLength]}
                    onValueChange={(v) => setPathConfig((prev) => ({ ...prev, scrollLength: v[0] }))}
                    min={1000}
                    max={10000}
                    step={100}
                    className="flex-1"
                  />
                  <span className="text-xs text-neutral-400 w-14">{pathConfig.scrollLength}px</span>
                </div>
              </Card>

              {/* Tabs */}
              <Tabs defaultValue="anchors" className="w-full">
                <TabsList className="grid w-full grid-cols-3 h-8 bg-neutral-800">
                  <TabsTrigger value="anchors" className="text-xs data-[state=active]:bg-neutral-700">
                    Anchors
                  </TabsTrigger>
                  <TabsTrigger value="control" className="text-xs data-[state=active]:bg-neutral-700">
                    Curves
                  </TabsTrigger>
                  <TabsTrigger value="rotation" className="text-xs data-[state=active]:bg-neutral-700">
                    Rotation
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="anchors" className="space-y-2 mt-2 max-h-64 overflow-y-auto">
                  <Button
                    onClick={addAnchorPoint}
                    variant="outline"
                    size="sm"
                    className="w-full text-xs h-8 bg-emerald-900/50 border-emerald-700 text-emerald-400 hover:bg-emerald-800/50"
                  >
                    <Plus className="mr-1 h-3 w-3" />
                    Add Anchor Point
                  </Button>

                  {pathConfig.positions.map((pos, idx) => (
                    <Card key={idx} className="p-2 bg-neutral-800 border-neutral-700">
                      <div className="flex items-center justify-between mb-2">
                        <Label className="text-xs font-semibold text-rose-400">Point {idx + 1}</Label>
                        {pathConfig.positions.length > 2 && (
                          <Button
                            onClick={() => removeAnchorPoint(idx)}
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5 text-neutral-500 hover:text-red-400"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        {(["x", "y", "z"] as const).map((axis) => (
                          <div key={axis} className="flex gap-2 items-center">
                            <Label className="text-xs w-6 text-neutral-400 uppercase">{axis}</Label>
                            <Slider
                              value={[pos[axis]]}
                              onValueChange={(v) => updatePosition(idx, axis, v[0])}
                              min={axis === "z" ? -500 : 0}
                              max={axis === "z" ? 500 : 100}
                              step={axis === "z" ? 10 : 1}
                              className="flex-1"
                            />
                            <Input
                              type="number"
                              value={pos[axis].toFixed(axis === "z" ? 0 : 0)}
                              onChange={(e) => updatePosition(idx, axis, Number.parseFloat(e.target.value))}
                              className="w-12 h-6 text-xs bg-neutral-700 border-neutral-600"
                            />
                          </div>
                        ))}
                        <div className="flex gap-2 items-center">
                          <Label className="text-xs w-6 text-neutral-400">S</Label>
                          <Slider
                            value={[pos.scale]}
                            onValueChange={(v) => updatePosition(idx, "scale", v[0])}
                            min={0.1}
                            max={3}
                            step={0.1}
                            className="flex-1"
                          />
                          <Input
                            type="number"
                            value={pos.scale.toFixed(1)}
                            onChange={(e) => updatePosition(idx, "scale", Number.parseFloat(e.target.value))}
                            className="w-12 h-6 text-xs bg-neutral-700 border-neutral-600"
                          />
                        </div>
                      </div>
                    </Card>
                  ))}
                </TabsContent>

                <TabsContent value="control" className="space-y-2 mt-2 max-h-64 overflow-y-auto">
                  {pathConfig.controlPoints.map((cp, idx) => (
                    <Card key={idx} className="p-2 bg-neutral-800 border-neutral-700">
                      <Label className="text-xs font-semibold mb-2 block text-emerald-400">CP {idx + 1}</Label>
                      <div className="space-y-1.5">
                        {(["x", "y", "z"] as const).map((axis) => (
                          <div key={axis} className="flex gap-2 items-center">
                            <Label className="text-xs w-6 text-neutral-400 uppercase">{axis}</Label>
                            <Slider
                              value={[cp[axis]]}
                              onValueChange={(v) => updateControlPoint(idx, axis, v[0])}
                              min={-500}
                              max={500}
                              step={10}
                              className="flex-1"
                            />
                            <Input
                              type="number"
                              value={cp[axis].toFixed(0)}
                              onChange={(e) => updateControlPoint(idx, axis, Number.parseFloat(e.target.value))}
                              className="w-12 h-6 text-xs bg-neutral-700 border-neutral-600"
                            />
                          </div>
                        ))}
                      </div>
                    </Card>
                  ))}
                </TabsContent>

                <TabsContent value="rotation" className="space-y-2 mt-2 max-h-64 overflow-y-auto">
                  <Button
                    onClick={addRotationKeyframe}
                    variant="outline"
                    size="sm"
                    className="w-full text-xs h-8 bg-blue-900/50 border-blue-700 text-blue-400 hover:bg-blue-800/50"
                  >
                    <Plus className="mr-1 h-3 w-3" />
                    Add Rotation Keyframe
                  </Button>

                  {pathConfig.rotationKeyframes
                    .sort((a, b) => a.progress - b.progress)
                    .map((kf, idx) => (
                      <Card key={idx} className="p-2 bg-neutral-800 border-neutral-700">
                        <div className="flex items-center justify-between mb-2">
                          <Label className="text-xs font-semibold text-blue-400">
                            Keyframe {idx + 1} ({(kf.progress * 100).toFixed(0)}%)
                          </Label>
                          {pathConfig.rotationKeyframes.length > 2 && (
                            <Button
                              onClick={() => removeRotationKeyframe(idx)}
                              variant="ghost"
                              size="icon"
                              className="h-5 w-5 text-neutral-500 hover:text-red-400"
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                        <div className="space-y-1.5">
                          <div className="flex gap-2 items-center">
                            <Label className="text-xs w-6 text-neutral-400">POS</Label>
                            <Slider
                              value={[kf.progress * 100]}
                              onValueChange={(v) => updateRotationKeyframe(idx, "progress", v[0] / 100)}
                              min={0}
                              max={100}
                              step={1}
                              className="flex-1"
                            />
                            <span className="text-xs w-10 text-neutral-400">{(kf.progress * 100).toFixed(0)}%</span>
                          </div>
                          {(["x", "y", "z"] as const).map((axis) => (
                            <div key={axis} className="flex gap-2 items-center">
                              <Label className="text-xs w-6 text-neutral-400 uppercase">{axis}</Label>
                              <Slider
                                value={[(kf[axis] * 180) / Math.PI]}
                                onValueChange={(v) => updateRotationKeyframe(idx, axis, (v[0] * Math.PI) / 180)}
                                min={-360}
                                max={360}
                                step={5}
                                className="flex-1"
                              />
                              <span className="text-xs w-10 text-neutral-400">
                                {Math.round((kf[axis] * 180) / Math.PI)}°
                              </span>
                            </div>
                          ))}
                        </div>
                      </Card>
                    ))}
                </TabsContent>
              </Tabs>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
