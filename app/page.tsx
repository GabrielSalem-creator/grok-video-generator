"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import {
  Menu,
  RotateCw,
  Play,
  ImagePlus,
  Loader2,
  Download,
  X,
  AlertCircle,
  ChevronDown,
} from "lucide-react";

type Status = "idle" | "generating" | "completed" | "failed";
type Mode = "text" | "image";

interface VideoResult {
  id: string;
  videoUrl: string;
  prompt: string;
  timestamp: Date;
}

const ASPECT_RATIOS = ["16:9", "9:16", "1:1", "4:3", "3:4"];

export default function Page() {
  const [activeTab, setActiveTab] = useState<"ask" | "imagine">("imagine");
  const [mode, setMode] = useState<Mode>("text");
  const [prompt, setPrompt] = useState("");
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [showAspectMenu, setShowAspectMenu] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [recentVideos, setRecentVideos] = useState<VideoResult[]>([]);
  const [currentResult, setCurrentResult] = useState<VideoResult | null>(null);
  
  // Image upload state
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const checkIOS = () => {
      const userAgent = window.navigator.userAgent.toLowerCase();
      return /iphone|ipad|ipod/.test(userAgent);
    };
    setIsIOS(checkIOS());
  }, []);

  const handleFileSelect = useCallback((file: File) => {
    const validTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
    if (!validTypes.includes(file.type)) {
      setError("Invalid file type. Supported: JPG, PNG, WEBP");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("File too large. Max 10MB.");
      return;
    }
    setError(null);
    setImageFile(file);
    const reader = new FileReader();
    reader.onload = (e) => setImagePreview(e.target?.result as string);
    reader.readAsDataURL(file);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFileSelect(file);
    },
    [handleFileSelect]
  );

  const removeImage = () => {
    setImageFile(null);
    setImagePreview(null);
    setImageUrl("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleGenerate = async () => {
    if (mode === "text" && !prompt.trim()) return;
    if (mode === "image" && !imageFile && !imageUrl.trim()) return;

    setStatus("generating");
    setError(null);
    setCurrentResult(null);

    try {
      let res;
      
      if (mode === "text") {
        res = await fetch("/api/video/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: prompt.trim(), aspectRatio }),
        });
      } else {
        const formData = new FormData();
        if (prompt.trim()) formData.append("prompt", prompt.trim());
        formData.append("aspectRatio", aspectRatio);
        if (imageUrl.trim()) {
          formData.append("imageUrl", imageUrl.trim());
        } else if (imageFile) {
          formData.append("image", imageFile);
        }
        res = await fetch("/api/video/image-to-video", {
          method: "POST",
          body: formData,
        });
      }

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to generate video");
        setStatus("failed");
        return;
      }

      const newResult: VideoResult = {
        id: data.id,
        videoUrl: data.videoUrl,
        prompt: prompt.trim() || "Image animation",
        timestamp: new Date(),
      };

      setCurrentResult(newResult);
      setRecentVideos((prev) => [newResult, ...prev].slice(0, 12));
      setStatus("completed");
    } catch {
      setError("Network error. Please try again.");
      setStatus("failed");
    }
  };

  const handleReset = () => {
    setStatus("idle");
    setError(null);
    setCurrentResult(null);
  };

  const isGenerating = status === "generating";
  const canGenerate =
    mode === "text"
      ? prompt.trim().length > 0
      : imageFile !== null || imageUrl.trim().length > 0;

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-4 pt-3 pb-2">
        <button
          aria-label="Menu"
          className="grid h-9 w-9 place-items-center rounded-full text-foreground hover:bg-surface-2 transition-colors"
        >
          <Menu className="h-5 w-5" strokeWidth={1.75} />
        </button>

        <div className="flex items-center gap-7">
          <button
            onClick={() => setActiveTab("ask")}
            className={`relative pb-1.5 text-[17px] font-semibold tracking-tight transition-colors ${
              activeTab === "ask" ? "text-foreground" : "text-muted-foreground"
            }`}
          >
            Ask
            <span
              className={`absolute -bottom-0.5 left-1/2 -translate-x-1/2 h-[3px] rounded-full bg-foreground transition-all duration-300 ${
                activeTab === "ask" ? "w-6 opacity-100" : "w-0 opacity-0"
              }`}
            />
          </button>
          <button
            onClick={() => setActiveTab("imagine")}
            className={`relative pb-1.5 text-[17px] font-semibold tracking-tight transition-colors ${
              activeTab === "imagine" ? "text-foreground" : "text-muted-foreground"
            }`}
          >
            Imagine
            <span
              className={`absolute -bottom-0.5 left-1/2 -translate-x-1/2 h-[3px] rounded-full bg-foreground transition-all duration-300 ${
                activeTab === "imagine" ? "w-6 opacity-100" : "w-0 opacity-0"
              }`}
            />
          </button>
        </div>

        <button
          aria-label="Refresh"
          onClick={handleReset}
          className="grid h-9 w-9 place-items-center rounded-full text-foreground hover:bg-surface-2 transition-colors"
        >
          <RotateCw className="h-5 w-5" strokeWidth={1.75} />
        </button>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0">
        <div className="flex-1 overflow-y-auto scrollbar-thin px-4 sm:px-6 pt-4 pb-[280px]">
          <div className="mx-auto w-full max-w-[720px] space-y-7">
            
            {/* Current Result */}
            {currentResult && status === "completed" && (
              <section className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="flex items-center justify-between mb-3 px-1">
                  <h2 className="text-lg font-semibold text-foreground">Generated Video</h2>
                  <button
                    onClick={() => setCurrentResult(null)}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="rounded-2xl overflow-hidden bg-surface-1 border border-border">
                  <video
                    src={currentResult.videoUrl}
                    controls
                    autoPlay
                    loop
                    playsInline
                    className="w-full aspect-video"
                  >
                    <track kind="captions" />
                  </video>
                  <div className="p-4 flex items-center justify-between">
                    <p className="text-sm text-muted-foreground truncate max-w-[70%]">
                      {currentResult.prompt}
                    </p>
                    <a
                      href={currentResult.videoUrl}
                      download
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-sm font-medium text-foreground hover:text-muted-foreground transition-colors"
                    >
                      <Download className="h-4 w-4" />
                      Download
                    </a>
                  </div>
                </div>
              </section>
            )}

            {/* Generating State */}
            {isGenerating && (
              <section className="animate-in fade-in duration-300">
                <div className="flex flex-col items-center justify-center gap-4 py-16 rounded-2xl bg-surface-1 border border-border">
                  <div className="relative">
                    <div className="h-12 w-12 rounded-full border-2 border-muted-foreground/20 border-t-foreground animate-spin" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-medium text-foreground">Generating your video...</p>
                    <p className="text-xs text-muted-foreground mt-1">This may take a moment</p>
                  </div>
                </div>
              </section>
            )}

            {/* Error State */}
            {status === "failed" && error && (
              <section className="animate-in fade-in duration-300">
                <div className="flex items-start gap-3 p-4 rounded-2xl bg-destructive/10 border border-destructive/20">
                  <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                  <div className="flex flex-col gap-2">
                    <p className="text-sm text-destructive">{error}</p>
                    <button
                      onClick={handleReset}
                      className="text-sm font-medium text-foreground hover:text-muted-foreground transition-colors w-fit"
                    >
                      Try again
                    </button>
                  </div>
                </div>
              </section>
            )}

            {/* Recent Videos */}
            {recentVideos.length > 0 && !isGenerating && (
              <section>
                <div className="flex items-center justify-between mb-3 px-1">
                  <h2 className="text-lg font-semibold text-foreground">Recent</h2>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {recentVideos.map((video) => (
                    <button
                      key={video.id}
                      onClick={() => setCurrentResult(video)}
                      className="group relative aspect-video rounded-xl overflow-hidden bg-surface-1 border border-border hover:border-muted-foreground/50 transition-all"
                    >
                      <video
                        src={video.videoUrl}
                        className="w-full h-full object-cover"
                        muted
                        playsInline
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <div className="h-10 w-10 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
                          <Play className="h-5 w-5 text-white fill-white" />
                        </div>
                      </div>
                      <p className="absolute bottom-2 left-2 right-2 text-xs text-white truncate opacity-0 group-hover:opacity-100 transition-opacity">
                        {video.prompt}
                      </p>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* Empty State */}
            {recentVideos.length === 0 && !isGenerating && !currentResult && status !== "failed" && (
              <section className="flex flex-col items-center justify-center py-20 text-center">
                <div className="h-16 w-16 rounded-2xl bg-surface-2 flex items-center justify-center mb-4">
                  <Play className="h-8 w-8 text-muted-foreground" />
                </div>
                <h2 className="text-lg font-semibold text-foreground mb-1">Create your first video</h2>
                <p className="text-sm text-muted-foreground max-w-sm">
                  Enter a prompt below to generate a cinematic AI video
                </p>
              </section>
            )}
          </div>
        </div>
      </main>

      {/* Bottom Input Area */}
      <div className="fixed bottom-0 left-0 right-0 bg-gradient-to-t from-background via-background to-transparent pt-6 pb-6 px-4">
        <div className="mx-auto w-full max-w-[720px]">
          <div className="rounded-2xl bg-surface-1 border border-border p-3 space-y-3">
            
            {/* Image Preview (Image Mode) */}
            {mode === "image" && (imagePreview || imageUrl) && (
              <div className="relative rounded-xl overflow-hidden bg-surface-2">
                <div className="aspect-video">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={imagePreview || imageUrl}
                    alt="Preview"
                    className="w-full h-full object-contain"
                  />
                </div>
                <button
                  onClick={removeImage}
                  className="absolute top-2 right-2 h-7 w-7 rounded-full bg-black/50 flex items-center justify-center text-white hover:bg-black/70 transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}

            {/* Textarea */}
            <textarea
              ref={textareaRef}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={mode === "text" ? "Describe the video you want to create..." : "Describe the motion (optional)..."}
              disabled={isGenerating}
              rows={2}
              className="w-full resize-none bg-transparent text-foreground placeholder:text-muted-foreground text-[15px] leading-relaxed focus:outline-none disabled:opacity-50"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !isGenerating && canGenerate) {
                  e.preventDefault();
                  handleGenerate();
                }
              }}
            />

            {/* Controls Row */}
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                {/* Aspect Ratio Selector */}
                <div className="relative">
                  <button
                    onClick={() => setShowAspectMenu(!showAspectMenu)}
                    disabled={isGenerating}
                    className="flex items-center gap-1.5 h-9 px-3 rounded-full bg-surface-2 text-sm font-medium text-foreground hover:bg-surface-3 transition-colors disabled:opacity-50"
                  >
                    {aspectRatio}
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                  {showAspectMenu && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setShowAspectMenu(false)} />
                      <div className="absolute bottom-full left-0 mb-2 py-1.5 rounded-xl bg-surface-2 border border-border shadow-xl z-20 min-w-[100px]">
                        {ASPECT_RATIOS.map((ratio) => (
                          <button
                            key={ratio}
                            onClick={() => {
                              setAspectRatio(ratio);
                              setShowAspectMenu(false);
                            }}
                            className={`w-full px-3 py-1.5 text-left text-sm transition-colors ${
                              aspectRatio === ratio
                                ? "text-foreground bg-surface-3"
                                : "text-muted-foreground hover:text-foreground hover:bg-surface-3"
                            }`}
                          >
                            {ratio}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>

                {/* Mode Toggle / Upload Button */}
                <button
                  onClick={() => {
                    if (mode === "text") {
                      setMode("image");
                    } else if (!imageFile && !imageUrl) {
                      if (!isIOS) {
                        fileInputRef.current?.click();
                      } else {
                        setMode("text");
                      }
                    } else {
                      setMode("text");
                      removeImage();
                    }
                  }}
                  disabled={isGenerating}
                  className={`h-9 w-9 rounded-full flex items-center justify-center transition-colors disabled:opacity-50 ${
                    mode === "image"
                      ? "bg-foreground text-background"
                      : "bg-surface-2 text-foreground hover:bg-surface-3"
                  }`}
                >
                  <ImagePlus className="h-4 w-4" />
                </button>

                {/* URL Input for iOS or when in image mode without file */}
                {mode === "image" && !imageFile && !imagePreview && (
                  <input
                    type="url"
                    value={imageUrl}
                    onChange={(e) => setImageUrl(e.target.value)}
                    placeholder="Paste image URL..."
                    disabled={isGenerating}
                    className="flex-1 h-9 px-3 rounded-full bg-surface-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-foreground/20 disabled:opacity-50"
                  />
                )}
              </div>

              {/* Generate Button */}
              <button
                onClick={handleGenerate}
                disabled={!canGenerate || isGenerating}
                className="h-9 px-5 rounded-full bg-foreground text-background text-sm font-semibold hover:bg-foreground/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="hidden sm:inline">Generating</span>
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 fill-current" />
                    <span className="hidden sm:inline">Generate</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Drag & Drop Zone (hidden, for desktop) */}
          {mode === "image" && !imageFile && !imageUrl && !isIOS && (
            <div
              onDrop={handleDrop}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                setIsDragging(false);
              }}
              className={`mt-2 p-3 rounded-xl border-2 border-dashed text-center text-sm transition-all cursor-pointer ${
                isDragging
                  ? "border-foreground bg-surface-2"
                  : "border-border text-muted-foreground hover:border-muted-foreground"
              }`}
              onClick={() => fileInputRef.current?.click()}
            >
              Drop an image here or click to upload
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept=".jpg,.jpeg,.png,.webp"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFileSelect(file);
            }}
            className="hidden"
          />
        </div>
      </div>
    </div>
  );
}
