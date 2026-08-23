"use client";

import { useState, useRef, useCallback, useEffect, useMemo, type ReactNode } from "react";
import {
  Play,
  ImagePlus,
  Loader2,
  Download,
  X,
  AlertCircle,
  ChevronDown,
  RotateCw,
  Clock,
  Monitor,
} from "lucide-react";

type Status = "idle" | "generating" | "completed" | "failed";
type Mode = "text" | "image";
type MenuKind = "model" | "aspect" | "duration" | "quality" | null;

interface VideoModel {
  id?: number;
  title: string;
  workflow_name: string;
  icon?: string;
  subtitle?: string;
  inputs?: {
    aspect_ratio?: string[];
    duration_options?: number[];
    quality_options?: string[];
  };
  estimated_duration_seconds?: number;
}

interface VideoResult {
  id: string;
  videoUrl: string;
  prompt: string;
  timestamp: Date;
}

function ChipButton({
  label,
  icon,
  open,
  disabled,
  onClick,
}: {
  label: string;
  icon?: ReactNode;
  open: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-1.5 h-9 px-3 rounded-full text-sm font-medium transition-colors disabled:opacity-50 ${
        open
          ? "bg-foreground text-background"
          : "bg-surface-2 text-foreground hover:bg-surface-3"
      }`}
    >
      {icon}
      <span className="max-w-[140px] truncate">{label}</span>
      <ChevronDown className="h-3.5 w-3.5 opacity-70 shrink-0" />
    </button>
  );
}

function OptionMenu({
  open,
  onClose,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  if (!open) return null;
  return (
    <>
      <div className="fixed inset-0 z-10" onClick={onClose} />
      <div
        className={`absolute bottom-full left-0 mb-2 py-1.5 rounded-xl bg-surface-2 border border-border shadow-xl z-20 max-h-64 overflow-y-auto scrollbar-thin ${
          wide ? "min-w-[260px] max-w-[min(92vw,340px)]" : "min-w-[110px]"
        }`}
      >
        {children}
      </div>
    </>
  );
}

export default function Page() {
  const [mode, setMode] = useState<Mode>("text");
  const [prompt, setPrompt] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [recentVideos, setRecentVideos] = useState<VideoResult[]>([]);
  const [currentResult, setCurrentResult] = useState<VideoResult | null>(null);

  const [textModels, setTextModels] = useState<VideoModel[]>([]);
  const [imageModels, setImageModels] = useState<VideoModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [duration, setDuration] = useState(5);
  const [quality, setQuality] = useState("720p");
  const [openMenu, setOpenMenu] = useState<MenuKind>(null);

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const models = mode === "text" ? textModels : imageModels;
  const activeModel = useMemo(
    () => models.find((m) => m.workflow_name === selectedModel) ?? models[0],
    [models, selectedModel]
  );

  const aspectOptions = activeModel?.inputs?.aspect_ratio?.length
    ? activeModel.inputs.aspect_ratio
    : ["16:9", "9:16", "1:1"];
  const durationOptions = activeModel?.inputs?.duration_options?.length
    ? activeModel.inputs.duration_options
    : [5, 10];
  const qualityOptions = activeModel?.inputs?.quality_options?.length
    ? activeModel.inputs.quality_options
    : ["720p"];

  // Sync selected options when model list / mode changes
  useEffect(() => {
    if (!models.length) return;
    const exists = models.some((m) => m.workflow_name === selectedModel);
    const next = exists ? selectedModel : models[0]!.workflow_name;
    if (next !== selectedModel) setSelectedModel(next);
  }, [models, selectedModel]);

  useEffect(() => {
    if (!activeModel) return;
    if (!aspectOptions.includes(aspectRatio)) {
      setAspectRatio(aspectOptions[0] ?? "16:9");
    }
    if (!durationOptions.includes(duration)) {
      setDuration(durationOptions[0] ?? 5);
    }
    if (!qualityOptions.includes(quality)) {
      setQuality(qualityOptions[0] ?? "720p");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeModel?.workflow_name]);

  useEffect(() => {
    setIsIOS(/iphone|ipad|ipod/.test(window.navigator.userAgent.toLowerCase()));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setModelsLoading(true);
        const res = await fetch("/api/video/models");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load models");
        if (cancelled) return;
        setTextModels(data.textToVideo || []);
        setImageModels(data.imageToVideo || []);
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof Error ? e.message : "Failed to load model catalog"
          );
        }
      } finally {
        if (!cancelled) setModelsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
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
    if (!selectedModel) {
      setError("Select a model first");
      return;
    }

    setStatus("generating");
    setError(null);
    setCurrentResult(null);
    setOpenMenu(null);

    try {
      let res: Response;

      if (mode === "text") {
        res = await fetch("/api/video/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: prompt.trim(),
            aspectRatio,
            model: selectedModel,
            duration,
            quality,
          }),
        });
      } else {
        const formData = new FormData();
        if (prompt.trim()) formData.append("prompt", prompt.trim());
        formData.append("aspectRatio", aspectRatio);
        formData.append("model", selectedModel);
        formData.append("duration", String(duration));
        formData.append("quality", quality);
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
      ? prompt.trim().length > 0 && !!selectedModel
      : (imageFile !== null || imageUrl.trim().length > 0) && !!selectedModel;

  const toggleMenu = (kind: MenuKind) => {
    setOpenMenu((prev) => (prev === kind ? null : kind));
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="flex items-center justify-between px-4 pt-3 pb-2">
        <div className="h-9 w-9" aria-hidden="true" />

        <div className="relative pb-1.5 text-[17px] font-semibold tracking-tight text-foreground">
          Imagine
          <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 h-[3px] w-6 rounded-full bg-foreground" />
        </div>

        <button
          type="button"
          aria-label="Clear and start over"
          onClick={handleReset}
          className="grid h-9 w-9 place-items-center rounded-full text-foreground hover:bg-surface-2 transition-colors"
        >
          <RotateCw className="h-5 w-5" strokeWidth={1.75} />
        </button>
      </header>

      <main className="flex-1 flex flex-col min-w-0">
        <div className="flex-1 overflow-y-auto scrollbar-thin px-4 sm:px-6 pt-4 pb-[360px]">
          <div className="mx-auto w-full max-w-[720px] space-y-7">
            {currentResult && status === "completed" && (
              <section className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="flex items-center justify-between mb-3 px-1">
                  <h2 className="text-lg font-semibold text-foreground">
                    Generated Video
                  </h2>
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

            {isGenerating && (
              <section className="animate-in fade-in duration-300">
                <div className="flex flex-col items-center justify-center gap-4 py-16 rounded-2xl bg-surface-1 border border-border">
                  <div className="h-12 w-12 rounded-full border-2 border-muted-foreground/20 border-t-foreground animate-spin" />
                  <div className="text-center">
                    <p className="text-sm font-medium text-foreground">
                      Generating with {activeModel?.title ?? "model"}…
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {duration}s · {aspectRatio} · {quality}
                      {activeModel?.estimated_duration_seconds
                        ? ` · ~${activeModel.estimated_duration_seconds}s wait`
                        : ""}
                    </p>
                  </div>
                </div>
              </section>
            )}

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

            {recentVideos.length > 0 && !isGenerating && (
              <section>
                <div className="flex items-center justify-between mb-3 px-1">
                  <h2 className="text-lg font-semibold text-foreground">
                    Recent
                  </h2>
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

            {recentVideos.length === 0 &&
              !isGenerating &&
              !currentResult &&
              status !== "failed" && (
                <section className="flex flex-col items-center justify-center py-20 text-center">
                  <div className="h-16 w-16 rounded-2xl bg-surface-2 flex items-center justify-center mb-4">
                    <Play className="h-8 w-8 text-muted-foreground" />
                  </div>
                  <h2 className="text-lg font-semibold text-foreground mb-1">
                    Create your first video
                  </h2>
                  <p className="text-sm text-muted-foreground max-w-sm">
                    Pick a model, canvas size, and duration — then describe your
                    scene
                  </p>
                </section>
              )}
          </div>
        </div>
      </main>

      <div className="fixed bottom-0 left-0 right-0 bg-gradient-to-t from-background via-background to-transparent pt-6 pb-6 px-4">
        <div className="mx-auto w-full max-w-[720px]">
          <div className="rounded-2xl bg-surface-1 border border-border p-3 space-y-3">
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

            <textarea
              ref={textareaRef}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={
                mode === "text"
                  ? "Describe the video you want to create..."
                  : "Describe the motion (optional)..."
              }
              disabled={isGenerating}
              rows={2}
              className="w-full resize-none bg-transparent text-foreground placeholder:text-muted-foreground text-[15px] leading-relaxed focus:outline-none disabled:opacity-50"
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !isGenerating &&
                  canGenerate
                ) {
                  e.preventDefault();
                  handleGenerate();
                }
              }}
            />

            {/* Model + options row */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <ChipButton
                  label={
                    modelsLoading
                      ? "Loading models…"
                      : activeModel?.title || "Model"
                  }
                  open={openMenu === "model"}
                  disabled={isGenerating || modelsLoading}
                  onClick={() => toggleMenu("model")}
                />
                <OptionMenu
                  open={openMenu === "model"}
                  onClose={() => setOpenMenu(null)}
                  wide
                >
                  {models.map((m) => (
                    <button
                      key={m.workflow_name}
                      type="button"
                      onClick={() => {
                        setSelectedModel(m.workflow_name);
                        setOpenMenu(null);
                      }}
                      className={`w-full px-3 py-2 text-left transition-colors ${
                        selectedModel === m.workflow_name
                          ? "bg-surface-3 text-foreground"
                          : "text-muted-foreground hover:text-foreground hover:bg-surface-3"
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        {m.icon ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={m.icon}
                            alt=""
                            className="h-6 w-6 rounded-md object-cover shrink-0"
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <div className="h-6 w-6 rounded-md bg-surface-1 shrink-0" />
                        )}
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">
                            {m.title}
                          </div>
                          {m.subtitle && (
                            <div className="text-[11px] opacity-70 truncate">
                              {m.subtitle}
                            </div>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </OptionMenu>
              </div>

              <div className="relative">
                <ChipButton
                  label={aspectRatio}
                  icon={<Monitor className="h-3.5 w-3.5 opacity-70" />}
                  open={openMenu === "aspect"}
                  disabled={isGenerating}
                  onClick={() => toggleMenu("aspect")}
                />
                <OptionMenu
                  open={openMenu === "aspect"}
                  onClose={() => setOpenMenu(null)}
                >
                  {aspectOptions.map((ratio) => (
                    <button
                      key={ratio}
                      type="button"
                      onClick={() => {
                        setAspectRatio(ratio);
                        setOpenMenu(null);
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
                </OptionMenu>
              </div>

              <div className="relative">
                <ChipButton
                  label={`${duration}s`}
                  icon={<Clock className="h-3.5 w-3.5 opacity-70" />}
                  open={openMenu === "duration"}
                  disabled={isGenerating}
                  onClick={() => toggleMenu("duration")}
                />
                <OptionMenu
                  open={openMenu === "duration"}
                  onClose={() => setOpenMenu(null)}
                >
                  {durationOptions.map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => {
                        setDuration(d);
                        setOpenMenu(null);
                      }}
                      className={`w-full px-3 py-1.5 text-left text-sm transition-colors ${
                        duration === d
                          ? "text-foreground bg-surface-3"
                          : "text-muted-foreground hover:text-foreground hover:bg-surface-3"
                      }`}
                    >
                      {d}s
                    </button>
                  ))}
                </OptionMenu>
              </div>

              <div className="relative">
                <ChipButton
                  label={quality}
                  open={openMenu === "quality"}
                  disabled={isGenerating}
                  onClick={() => toggleMenu("quality")}
                />
                <OptionMenu
                  open={openMenu === "quality"}
                  onClose={() => setOpenMenu(null)}
                >
                  {qualityOptions.map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => {
                        setQuality(q);
                        setOpenMenu(null);
                      }}
                      className={`w-full px-3 py-1.5 text-left text-sm transition-colors ${
                        quality === q
                          ? "text-foreground bg-surface-3"
                          : "text-muted-foreground hover:text-foreground hover:bg-surface-3"
                      }`}
                    >
                      {q}
                    </button>
                  ))}
                </OptionMenu>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0 flex-1">
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
                  className={`h-9 w-9 rounded-full flex items-center justify-center transition-colors disabled:opacity-50 shrink-0 ${
                    mode === "image"
                      ? "bg-foreground text-background"
                      : "bg-surface-2 text-foreground hover:bg-surface-3"
                  }`}
                >
                  <ImagePlus className="h-4 w-4" />
                </button>

                {mode === "image" && !imageFile && !imagePreview && (
                  <input
                    type="url"
                    value={imageUrl}
                    onChange={(e) => setImageUrl(e.target.value)}
                    placeholder="Paste image URL..."
                    disabled={isGenerating}
                    className="flex-1 min-w-0 h-9 px-3 rounded-full bg-surface-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-foreground/20 disabled:opacity-50"
                  />
                )}

                <span className="hidden sm:inline text-[11px] text-muted-foreground truncate">
                  {models.length
                    ? `${models.length} models · ${mode === "text" ? "text→video" : "image→video"}`
                    : modelsLoading
                      ? "Loading catalog…"
                      : "No models"}
                </span>
              </div>

              <button
                onClick={handleGenerate}
                disabled={!canGenerate || isGenerating}
                className="h-9 px-5 rounded-full bg-foreground text-background text-sm font-semibold hover:bg-foreground/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 shrink-0"
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
