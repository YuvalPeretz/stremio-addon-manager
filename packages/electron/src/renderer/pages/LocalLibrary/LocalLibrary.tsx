/**
 * Local Library — manage Pi-side folders/files and metadata for Stremio local streams.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAtom, useAtomValue } from "jotai";
import { useParams, Navigate, useNavigate } from "react-router-dom";
import {
  Alert,
  Breadcrumb,
  Button,
  Card,
  Dropdown,
  Flex,
  Form,
  Input,
  InputNumber,
  Modal,
  Radio,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from "antd";
import type { MenuProps } from "antd";
import type { ColumnsType } from "antd/es/table";
import { FiArrowLeft, FiEdit2, FiFile, FiFolder, FiMoreHorizontal, FiRefreshCw, FiTrash2 } from "react-icons/fi";
import { configAtom, configExistsAtom } from "../../atoms/configAtoms";
import { selectedAddonAtom, selectedAddonIdAtom } from "../../atoms/addonAtoms";
import type { AddonManagerConfig } from "@stremio-addon-manager/core";
import { buildAddonHttpApiBase } from "../../utils/addonUrls";
import styles from "./LocalLibrary.module.scss";

const { Title, Text, Paragraph } = Typography;

interface LibraryRoot {
  id: string;
  kind: "file" | "folder";
  path: string;
  defaultMetadata?: LocalFileMetadata;
  addedAt: string;
}

interface LocalFileMetadata {
  imdbId?: string;
  type?: "movie" | "series";
  season?: number;
  episode?: number;
  displayName?: string;
  language?: string;
  resolution?: string;
  year?: number;
}

interface LibrarySummary {
  enabled: boolean;
  dataDir: string;
  roots: LibraryRoot[];
  indexedCount: number;
  scan: { maxDepth: number; maxFiles: number };
}

interface IndexedFile {
  fileId: string;
  canonicalPath: string;
  basename: string;
  effective: LocalFileMetadata;
  rootId: string;
}

interface BrowseEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isFile: boolean;
  rootId?: string;
  kind?: "file" | "folder";
  exists?: boolean;
}

const ADDON_API_PASSWORD_HEADER = "X-Stremio-Addon-Password";

/** Keep in sync with addon-server `local-library/video-extensions.ts`. */
const LOCAL_LIBRARY_VIDEO_EXT = new Set([".mkv", ".mp4", ".webm", ".avi", ".m4v", ".mov", ".wmv"]);
const LOCAL_LIBRARY_VIDEO_EXT_READABLE = ".mkv, .mp4, .webm, .avi, .m4v, .mov, .wmv";

function isSupportedLocalLibraryVideoPath(filePath: string): boolean {
  const base = filePath.replace(/\/+$/, "").split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot < 0) return false;
  return LOCAL_LIBRARY_VIDEO_EXT.has(base.slice(dot).toLowerCase());
}

function posixJoin(a: string, b: string): string {
  const left = a.replace(/\/+$/, "");
  const right = b.replace(/^\/+/, "");
  return `${left}/${right}`;
}

/** Segments for breadcrumb navigation on the Pi (POSIX paths). */
function pathBreadcrumbSegments(absPath: string): { label: string; path: string }[] {
  const normalized = absPath.replace(/\/+$/, "") || "/";
  if (normalized === "/") {
    return [{ label: "/", path: "/" }];
  }
  const parts = normalized.split("/").filter(Boolean);
  const segments: { label: string; path: string }[] = [{ label: "/", path: "/" }];
  let acc = "";
  for (const part of parts) {
    acc += `/${part}`;
    segments.push({ label: part, path: acc });
  }
  return segments;
}

/** Path the manager will sync for LOCAL_LIBRARY_DATA_DIR (null = disabled in YAML or no addon dir). */
function computeLocalLibraryDataDirFromConfig(c: AddonManagerConfig): string | null {
  const explicit = c.paths?.localLibraryDataDir;
  if (explicit !== undefined && explicit.trim() === "") return null;
  const addonDir = c.paths?.addonDirectory?.trim();
  if (!addonDir) return null;
  const dir = (explicit?.trim() || posixJoin(addonDir, "local-library")).replace(/\/+$/, "");
  return dir || null;
}

/**
 * Base URL for addon HTTP API calls from Electron (password sent in header, not in path).
 * Prefers customScript.publicUrl (full base including Gateway /svc-xxx/ prefix).
 */
function buildAddonHttpApi(config: AddonManagerConfig): { baseUrl: string; password: string } | null {
  const password = config.addon?.password?.trim();
  const baseUrl = buildAddonHttpApiBase(config);
  if (!baseUrl || !password) return null;
  return { baseUrl, password };
}

function LocalLibrary() {
  const { addonId: addonIdParam } = useParams<{ addonId: string }>();
  const navigate = useNavigate();
  const [config, setConfig] = useAtom(configAtom);
  const [configExists, setConfigExists] = useAtom(configExistsAtom);
  const [selectedAddonId, setSelectedAddonId] = useAtom(selectedAddonIdAtom);
  const selectedAddon = useAtomValue(selectedAddonAtom);

  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<LibrarySummary | null>(null);
  const [files, setFiles] = useState<IndexedFile[]>([]);
  const [browsePath, setBrowsePath] = useState("");
  const [browseEntries, setBrowseEntries] = useState<BrowseEntry[]>([]);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<BrowseEntry | null>(null);
  const [serverLibraryDisabled, setServerLibraryDisabled] = useState(false);

  const [rootModalOpen, setRootModalOpen] = useState(false);
  const [editingRoot, setEditingRoot] = useState<LibraryRoot | null>(null);
  const [fileModalOpen, setFileModalOpen] = useState(false);
  const [editingFile, setEditingFile] = useState<IndexedFile | null>(null);
  const [manualPathOpen, setManualPathOpen] = useState(false);
  const [manualPathValue, setManualPathValue] = useState("");
  const [manualKind, setManualKind] = useState<"folder" | "file">("folder");

  /** After library summary loads, set browse top: `/` when there are no roots yet, else configured roots list (`""`). */
  const browseTopSynced = useRef(false);
  /** Skip one header→URL sync right after the route or loadConfig aligned the selector (avoids fighting on first paint). */
  const suppressHeaderToUrlNav = useRef(false);

  const [rootForm] = Form.useForm();
  const [fileForm] = Form.useForm();

  const httpApi = useMemo(() => (config ? buildAddonHttpApi(config) : null), [config]);

  const loadConfig = useCallback(async () => {
    if (!addonIdParam) return;
    const existsResult = await window.electron.config.exists(addonIdParam);
    if (existsResult.success && existsResult.data) {
      setConfigExists(true);
      const configResult = await window.electron.config.load(addonIdParam);
      if (configResult.success && configResult.data) {
        setConfig(configResult.data as AddonManagerConfig);
      }
    } else {
      setConfigExists(false);
      setConfig(null);
    }
  }, [addonIdParam, setConfig, setConfigExists]);

  useEffect(() => {
    if (!addonIdParam) return;
    suppressHeaderToUrlNav.current = true;
    setSelectedAddonId(addonIdParam);
  }, [addonIdParam, setSelectedAddonId]);

  useEffect(() => {
    if (!addonIdParam || !selectedAddonId) return;
    if (suppressHeaderToUrlNav.current) {
      suppressHeaderToUrlNav.current = false;
      return;
    }
    if (selectedAddonId !== addonIdParam) {
      navigate(`/local-library/${encodeURIComponent(selectedAddonId)}`, { replace: true });
    }
  }, [addonIdParam, selectedAddonId, navigate]);

  const apiFetch = useCallback(
    async (path: string, init?: RequestInit) => {
      if (!httpApi) throw new Error("Missing addon URL");
      // Join under base (preserve Gateway path prefix; avoid origin-root absolute paths)
      const base = httpApi.baseUrl.replace(/\/+$/, "");
      const suffix = path.replace(/^\/+/, "");
      const url = suffix ? `${base}/${suffix}` : base;
      const res = await fetch(url, {
        ...init,
        headers: {
          [ADDON_API_PASSWORD_HEADER]: httpApi.password,
          ...(init?.body ? { "Content-Type": "application/json" } : {}),
          ...init?.headers,
        },
      });
      const text = await res.text();
      let data: unknown = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = text;
      }
      if (!res.ok) {
        const looksLikeHtml = /<!DOCTYPE\s+html/i.test(text) || /<\s*html[\s>]/i.test(text);
        if (res.status === 404 && looksLikeHtml) {
          throw new Error(
            "The addon at this URL does not expose the Local Library API (404). Use the same host you use for Stremio (Configuration → Domain), not the Electron/Vite dev server. Redeploy or update the addon on the Pi if this build is old."
          );
        }
        const looksLikeReverseProxyError =
          looksLikeHtml ||
          /\bBad Gateway\b/i.test(text) ||
          /\bGateway Time-?out\b/i.test(text) ||
          (/\bnginx\b/i.test(text) && /<title>\s*\d{3}\s/i.test(text));
        if (looksLikeReverseProxyError && (res.status === 502 || res.status === 503 || res.status === 504)) {
          const timeout504 =
            res.status === 504
              ? ` HTTP 504 often means nginx gave up waiting (proxy_read_timeout). Older manager installs used only 10s for non-stream paths; Local Library browse can need more. On the Pi, raise timeouts for local-library and location / (e.g. proxy_read_timeout 300s), then run sudo nginx -t && sudo systemctl reload nginx. To test the Node process directly on the Pi (bypassing public nginx), SSH in and run curl against http://127.0.0.1:<your-addon-port>/local-library/browse?path=%2F with header X-Stremio-Addon-Password; this manager uses your configured Domain (e.g. tunnel or LAN IP), not that loopback URL.`
              : "";
          throw new Error(
            `Nginx (or another reverse proxy) returned HTTP ${res.status}: it could not reach the Node addon in time, or the upstream is overloaded. ` +
              `On the Pi: confirm the addon service is running (e.g. systemctl status your addon unit), that it listens on the port in your config (often 7000), and that nginx proxy_pass targets that same host and port. ` +
              `Reload nginx after config changes.${timeout504}`
          );
        }
        const errMsg =
          typeof data === "object" && data && "error" in data
            ? String((data as { error: string }).error)
            : text || res.statusText;
        const err = new Error(errMsg || `HTTP ${res.status}`) as Error & { httpStatus?: number };
        err.httpStatus = res.status;
        throw err;
      }
      return data;
    },
    [httpApi]
  );

  const refreshLibrary = useCallback(async () => {
    if (!httpApi) return;
    setLoading(true);
    try {
      const lib = (await apiFetch("/local-library")) as LibrarySummary;
      setServerLibraryDisabled(false);
      setSummary(lib);
      const filesRes = (await apiFetch("/local-library/files")) as { files: IndexedFile[] };
      setFiles(filesRes.files ?? []);
    } catch (e) {
      const err = e as Error & { httpStatus?: number };
      const disabled =
        err.httpStatus === 503 ||
        /local library is disabled|LOCAL_LIBRARY_DATA_DIR/i.test(err.message || "");
      setServerLibraryDisabled(disabled);
      if (!disabled) {
        message.error(err.message || "Failed to load local library");
      }
      setSummary(null);
      setFiles([]);
      browseTopSynced.current = false;
    } finally {
      setLoading(false);
    }
  }, [apiFetch, httpApi]);

  const refreshBrowse = useCallback(async () => {
    if (!httpApi) return;
    setBrowseLoading(true);
    try {
      const q = browsePath ? `?path=${encodeURIComponent(browsePath)}` : "";
      const data = (await apiFetch(`/local-library/browse${q}`)) as {
        path: string;
        entries: BrowseEntry[];
      };
      setBrowseEntries(data.entries ?? []);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "Browse failed");
      setBrowseEntries([]);
    } finally {
      setBrowseLoading(false);
    }
  }, [apiFetch, httpApi, browsePath]);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    browseTopSynced.current = false;
  }, [httpApi, addonIdParam]);

  useEffect(() => {
    if (httpApi) void refreshLibrary();
  }, [httpApi, refreshLibrary]);

  useEffect(() => {
    if (!httpApi || summary === null) return;
    if (!browseTopSynced.current) {
      browseTopSynced.current = true;
      setBrowsePath(summary.roots.length > 0 ? "" : "/");
    }
  }, [httpApi, summary]);

  useEffect(() => {
    if (!httpApi || summary === null) return;
    void refreshBrowse();
  }, [httpApi, browsePath, summary, refreshBrowse]);

  const countByRoot = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of files) {
      m.set(f.rootId, (m.get(f.rootId) ?? 0) + 1);
    }
    return m;
  }, [files]);

  const localLibraryResolvedDir = useMemo(
    () => (config ? computeLocalLibraryDataDirFromConfig(config) : null),
    [config]
  );

  function openEditRoot(root: LibraryRoot) {
    setEditingRoot(root);
    rootForm.setFieldsValue({
      imdbId: root.defaultMetadata?.imdbId,
      type: root.defaultMetadata?.type,
      displayName: root.defaultMetadata?.displayName,
      language: root.defaultMetadata?.language,
      resolution: root.defaultMetadata?.resolution,
      year: root.defaultMetadata?.year,
    });
    setRootModalOpen(true);
  }

  async function saveRootDefaults() {
    if (!editingRoot) return;
    try {
      const v = await rootForm.validateFields();
      const defaultMetadata: LocalFileMetadata = {
        imdbId: v.imdbId || undefined,
        type: v.type || undefined,
        displayName: v.displayName || undefined,
        language: v.language || undefined,
        resolution: v.resolution || undefined,
        year: v.year ?? undefined,
      };
      await apiFetch(`/local-library/roots/${editingRoot.id}`, {
        method: "PATCH",
        body: JSON.stringify({ defaultMetadata }),
      });
      message.success("Root defaults updated");
      setRootModalOpen(false);
      setEditingRoot(null);
      await refreshLibrary();
    } catch (e) {
      if (e && typeof e === "object" && "errorFields" in e) return;
      message.error(e instanceof Error ? e.message : "Update failed");
    }
  }

  async function removeRoot(root: LibraryRoot) {
    Modal.confirm({
      title: "Remove library root?",
      content: root.path,
      okType: "danger",
      onOk: async () => {
        try {
          await apiFetch(`/local-library/roots/${root.id}`, { method: "DELETE" });
          message.success("Root removed");
          await refreshLibrary();
        } catch (e) {
          message.error(e instanceof Error ? e.message : "Remove failed");
        }
      },
    });
  }

  async function globalReindex() {
    try {
      await apiFetch("/local-library/reindex", { method: "POST" });
      message.success("Reindex complete");
      await refreshLibrary();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "Reindex failed");
    }
  }

  const addRootAtPath = useCallback(
    async (kind: "file" | "folder", pathToAdd: string): Promise<boolean> => {
      const p = pathToAdd.trim();
      if (!p) {
        message.warning("No path selected");
        return false;
      }
      if (kind === "file" && !isSupportedLocalLibraryVideoPath(p)) {
        message.warning(
          `Only supported video files can be added as file sources (${LOCAL_LIBRARY_VIDEO_EXT_READABLE}).`
        );
        return false;
      }
      try {
        await apiFetch("/local-library/roots", {
          method: "POST",
          body: JSON.stringify({ kind, path: p }),
        });
        message.success("Source added");
        await refreshLibrary();
        await refreshBrowse();
        return true;
      } catch (e) {
        message.error(e instanceof Error ? e.message : "Failed to add source");
        return false;
      }
    },
    [apiFetch, refreshLibrary, refreshBrowse]
  );

  async function addRootFromBrowse(kind: "file" | "folder") {
    const path = kind === "file" ? selectedEntry?.path : browsePath || selectedEntry?.path;
    if (!path) {
      message.warning(
        kind === "folder"
          ? "Use Open on a folder to go inside it, then Add current folder — or Add as folder source on any folder row."
          : "Use Add as file source on a file row, or select a file and use the button below."
      );
      return;
    }
    await addRootAtPath(kind, path);
  }

  async function addRootByManualPath() {
    const p = manualPathValue.trim();
    if (!p) {
      message.warning("Enter an absolute path on the Pi (e.g. /media/usb/Movies)");
      return;
    }
    const ok = await addRootAtPath(manualKind, p);
    if (ok) {
      setManualPathOpen(false);
      setManualPathValue("");
    }
  }

  const navigateBrowseTo = useCallback((nextPath: string) => {
    setBrowsePath(nextPath);
    setSelectedEntry(null);
  }, []);

  const browseMoreMenu = useMemo<MenuProps>(
    () => ({
      items: [
        {
          key: "manual",
          label: "Enter path manually…",
          onClick: () => setManualPathOpen(true),
        },
      ],
    }),
    []
  );

  const browseColumns: ColumnsType<BrowseEntry> = useMemo(
    () => [
      {
        title: "Name",
        key: "name",
        ellipsis: true,
        render: (_, e) => (
          <Space size="small">
            {e.isDirectory ? <FiFolder aria-hidden /> : <FiFile aria-hidden />}
            <span>{e.name}</span>
          </Space>
        ),
      },
      {
        title: "Type",
        key: "t",
        width: 88,
        render: (_, e) => (e.isDirectory ? <Tag>Folder</Tag> : <Tag>File</Tag>),
      },
      {
        title: "Actions",
        key: "act",
        width: 340,
        render: (_, e) => (
          <Space size="small" wrap onClick={(ev) => ev.stopPropagation()}>
            {e.isDirectory ? (
              <>
                <Button type="link" size="small" onClick={() => navigateBrowseTo(e.path)}>
                  Open
                </Button>
                <Button type="link" size="small" onClick={() => void addRootAtPath("folder", e.path)}>
                  Add as folder source
                </Button>
              </>
            ) : (
              <Tooltip
                title={
                  isSupportedLocalLibraryVideoPath(e.path)
                    ? undefined
                    : `Not a supported video type. Allowed: ${LOCAL_LIBRARY_VIDEO_EXT_READABLE}`
                }
              >
                <span>
                  <Button
                    type="link"
                    size="small"
                    disabled={!isSupportedLocalLibraryVideoPath(e.path)}
                    onClick={() => void addRootAtPath("file", e.path)}
                  >
                    Add as file source
                  </Button>
                </span>
              </Tooltip>
            )}
          </Space>
        ),
      },
    ],
    [addRootAtPath, navigateBrowseTo]
  );

  const browseBreadcrumbItems = useMemo(() => {
    if (!browsePath) {
      return [{ title: <span className={styles.breadcrumbCurrent}>Library roots</span> }];
    }
    const segments = pathBreadcrumbSegments(browsePath);
    return segments.map((seg, idx) => {
      const isLast = idx === segments.length - 1;
      return {
        title: isLast ? (
          <span className={styles.breadcrumbCurrent}>{seg.label}</span>
        ) : (
          <button
            type="button"
            className={styles.breadcrumbLink}
            onClick={() => navigateBrowseTo(seg.path)}
          >
            {seg.label}
          </button>
        ),
      };
    });
  }, [browsePath, navigateBrowseTo]);

  function openEditFile(rec: IndexedFile) {
    setEditingFile(rec);
    const m = rec.effective;
    fileForm.setFieldsValue({
      imdbId: m.imdbId,
      type: m.type,
      season: m.season,
      episode: m.episode,
      displayName: m.displayName,
      language: m.language,
      resolution: m.resolution,
      year: m.year,
    });
    setFileModalOpen(true);
  }

  async function saveFileOverride() {
    if (!editingFile) return;
    try {
      const v = await fileForm.validateFields();
      const metadata: LocalFileMetadata = {
        imdbId: v.imdbId || undefined,
        type: v.type || undefined,
        season: v.season ?? undefined,
        episode: v.episode ?? undefined,
        displayName: v.displayName || undefined,
        language: v.language || undefined,
        resolution: v.resolution || undefined,
        year: v.year ?? undefined,
      };
      await apiFetch("/local-library/files", {
        method: "PATCH",
        body: JSON.stringify({ canonicalPath: editingFile.canonicalPath, metadata }),
      });
      message.success("File metadata saved");
      setFileModalOpen(false);
      setEditingFile(null);
      await refreshLibrary();
    } catch (e) {
      if (e && typeof e === "object" && "errorFields" in e) return;
      message.error(e instanceof Error ? e.message : "Save failed");
    }
  }

  async function clearFileOverride() {
    if (!editingFile) return;
    try {
      await apiFetch("/local-library/files", {
        method: "PATCH",
        body: JSON.stringify({ canonicalPath: editingFile.canonicalPath, clear: true }),
      });
      message.success("Overrides cleared");
      setFileModalOpen(false);
      setEditingFile(null);
      await refreshLibrary();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "Clear failed");
    }
  }

  const rootColumns: ColumnsType<LibraryRoot> = [
    {
      title: "Path",
      dataIndex: "path",
      key: "path",
      ellipsis: true,
      render: (p: string) => <span className={styles.pathText}>{p}</span>,
    },
    {
      title: "Kind",
      dataIndex: "kind",
      key: "kind",
      width: 90,
      render: (k: string) => <Tag>{k}</Tag>,
    },
    {
      title: "Videos",
      key: "count",
      width: 90,
      render: (_, r) => countByRoot.get(r.id) ?? 0,
    },
    {
      title: "Actions",
      key: "actions",
      width: 280,
      render: (_, r) => (
        <Space size="small" wrap>
          <Button type="link" size="small" icon={<FiEdit2 />} onClick={() => openEditRoot(r)}>
            Defaults
          </Button>
          <Button type="link" size="small" icon={<FiRefreshCw />} onClick={() => void globalReindex()}>
            Reindex all
          </Button>
          <Button type="link" size="small" danger icon={<FiTrash2 />} onClick={() => void removeRoot(r)}>
            Remove
          </Button>
        </Space>
      ),
    },
  ];

  const fileColumns: ColumnsType<IndexedFile> = [
    { title: "File", dataIndex: "basename", key: "basename", ellipsis: true },
    {
      title: "imdbId",
      key: "imdb",
      width: 120,
      render: (_, r) => r.effective.imdbId ?? "—",
    },
    {
      title: "S/E",
      key: "se",
      width: 72,
      render: (_, r) =>
        typeof r.effective.season === "number" && typeof r.effective.episode === "number"
          ? `S${r.effective.season}E${r.effective.episode}`
          : "—",
    },
    {
      title: "Actions",
      key: "fa",
      width: 100,
      render: (_, r) => (
        <Button type="link" size="small" onClick={() => openEditFile(r)}>
          Edit
        </Button>
      ),
    },
  ];

  if (!addonIdParam) {
    return <Navigate to="/dashboard" replace />;
  }

  if (!configExists || !config) {
    return (
      <div className={styles.page}>
        <Flex vertical gap={12}>
          <Button icon={<FiArrowLeft />} onClick={() => navigate("/dashboard")}>
            Back to Dashboard
          </Button>
          <Alert
            type="info"
            message="No configuration for this addon"
            description={`There is no saved YAML for addon id “${addonIdParam}”. Use Configuration for this addon, or pick another addon in the header.`}
            showIcon
          />
        </Flex>
      </div>
    );
  }

  if (!httpApi) {
    return (
      <div className={styles.page}>
        <Flex vertical gap={12}>
          <Button icon={<FiArrowLeft />} onClick={() => navigate("/dashboard")}>
            Back to Dashboard
          </Button>
          <Alert
            type="warning"
            message="Addon public URL (or domain) and password are required to talk to the addon HTTP API."
            description="Set them under Configuration for this addon. Use the same host you use in Stremio (public URL, tunnel, or LAN such as 192.168.0.50:7000 if that is what you configured)—not this manager app’s dev URL."
            showIcon
          />
        </Flex>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <Flex
        align="center"
        justify="space-between"
        gap={12}
        wrap="wrap"
        style={{ marginBottom: 24 }}
      >
        <Flex align="center" gap={12} wrap="wrap">
          <Button icon={<FiArrowLeft />} onClick={() => navigate("/dashboard")}>
            Dashboard
          </Button>
          <FiFolder size={28} />
          <div>
            <Title level={3} style={{ margin: 0 }}>
              Local Library
            </Title>
            <Text type="secondary">Folders and files on the addon host (Local streams in Stremio)</Text>
          </div>
        </Flex>
        {selectedAddon ? (
          <Tag color="blue">
            {selectedAddon.name} · {selectedAddon.id}
          </Tag>
        ) : (
          <Tag>{addonIdParam}</Tag>
        )}
      </Flex>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="Local library data directory"
        description={
          <Flex vertical gap={8}>
            <Paragraph style={{ marginBottom: 0 }} type="secondary">
              HTTP requests use this addon’s <strong>Domain</strong> and <strong>password</strong> from Configuration—the
              same base URL Stremio uses (tunnel hostname, HTTPS, or a LAN host like <Text code>192.168.0.50:7000</Text> if
              you entered that). On the Pi, nginx often proxies from the public host to Node on{" "}
              <Text code>127.0.0.1</Text>; that loopback address is only between nginx and the addon process, not what you
              type here.
            </Paragraph>
            <Paragraph style={{ marginBottom: 0 }}>
              <Text code>LOCAL_LIBRARY_DATA_DIR</Text> is set for you when you <strong>install or update</strong> the addon
              (default <Text code>&lt;addonDirectory&gt;/local-library</Text>). The running addon also defaults to{" "}
              <Text code>local-library</Text> under its working directory if the variable is missing from systemd, so you
              usually do not need to touch it. To <strong>disable</strong> the feature, set{" "}
              <Text code>paths.localLibraryDataDir</Text> to an empty string in your YAML and sync the service; to use a
              custom path, set that field or edit the env row under Environment variables.
            </Paragraph>
            {localLibraryResolvedDir ? (
              <Text type="secondary">
                From your saved config, sync would use: <Text code>{localLibraryResolvedDir}</Text>
              </Text>
            ) : (
              <Text type="secondary">
                Complete Installation (addon directory) so the manager can show the path that will be synced.
              </Text>
            )}
          </Flex>
        }
      />

      {serverLibraryDisabled && (
        <Alert
          style={{ marginBottom: 16 }}
          type="warning"
          showIcon
          message="The running addon has local library turned off"
          description="It was started with an empty LOCAL_LIBRARY_DATA_DIR. Redeploy or update the addon, or remove the empty override and sync the service. An empty list of roots is normal until you add folders below."
        />
      )}

      {summary && summary.dataDir && (
        <Paragraph type="secondary" style={{ marginBottom: 16 }}>
          Data: <Text code>{summary.dataDir}</Text> · Indexed: {summary.indexedCount} · Scan depth ≤{" "}
          {summary.scan.maxDepth}, files ≤ {summary.scan.maxFiles}
        </Paragraph>
      )}

      <Card
        className={styles.section}
        title="Library browser"
        extra={
          <Dropdown menu={browseMoreMenu} trigger={["click"]}>
            <Button icon={<FiMoreHorizontal />}>More</Button>
          </Dropdown>
        }
      >
        <Paragraph type="secondary" style={{ marginTop: 0, marginBottom: 12 }}>
          Pick sources from the list: use <strong>Open</strong> on a folder to move into it (or double-click the row).
          Use <strong>Add as folder source</strong> or <strong>Add as file source</strong> on the row you want. The bar
          below shows where you are; click a segment to jump up. After you open a folder, you can also use{" "}
          <strong>Add current folder as source</strong>.
        </Paragraph>
        <Flex wrap="wrap" gap="small" className={styles.browseBar} align="center">
          <Button
            disabled={!browsePath || browsePath === "/"}
            onClick={() => {
              const parent = browsePath.replace(/[/\\][^/\\]*$/, "");
              navigateBrowseTo(parent);
            }}
          >
            Parent folder
          </Button>
          <Button
            onClick={() =>
              navigateBrowseTo(summary && summary.roots.length > 0 ? "" : "/")
            }
          >
            {summary && summary.roots.length > 0 ? "Back to library roots" : "Back to filesystem root (/)"}
          </Button>
          <Button type="primary" onClick={() => void addRootFromBrowse("folder")}>
            Add current folder as source
          </Button>
          <Tooltip
            title={
              selectedEntry?.isFile && !isSupportedLocalLibraryVideoPath(selectedEntry.path)
                ? `Not a supported video type. Allowed: ${LOCAL_LIBRARY_VIDEO_EXT_READABLE}`
                : undefined
            }
          >
            <span>
              <Button
                onClick={() => void addRootFromBrowse("file")}
                disabled={
                  !selectedEntry?.isFile ||
                  !isSupportedLocalLibraryVideoPath(selectedEntry.path)
                }
              >
                Add selected file as source
              </Button>
            </span>
          </Tooltip>
          <Button icon={<FiRefreshCw />} onClick={() => void refreshBrowse()} loading={browseLoading}>
            Reload listing
          </Button>
        </Flex>
        <div className={styles.breadcrumbBar}>
          <Text type="secondary" style={{ marginRight: 8 }}>
            Location:
          </Text>
          <Breadcrumb items={browseBreadcrumbItems} />
        </div>
        <Table
          style={{ marginTop: 12 }}
          rowKey={(e) => e.path}
          loading={browseLoading}
          size="small"
          columns={browseColumns}
          dataSource={browseEntries}
          pagination={false}
          scroll={{ x: "max-content" }}
          rowClassName={(record) =>
            selectedEntry?.path === record.path ? styles.browseRowSelected : ""
          }
          onRow={(record) => ({
            onClick: () => setSelectedEntry(record),
            onDoubleClick: () => {
              if (record.isDirectory) {
                navigateBrowseTo(record.path);
              }
            },
          })}
        />
      </Card>

      <Card className={styles.section} title="Configured locations" extra={<Button icon={<FiRefreshCw />} onClick={() => void refreshLibrary()} loading={loading}>Refresh</Button>}>
        <Table
          rowKey="id"
          loading={loading}
          columns={rootColumns}
          dataSource={summary?.roots ?? []}
          pagination={false}
          locale={{
            emptyText: "No roots yet — add folders or files using the browser above",
          }}
        />
      </Card>

      <Card className={styles.section} title="Indexed files (per-root overrides)">
        <Table
          rowKey="fileId"
          loading={loading}
          size="small"
          columns={fileColumns}
          dataSource={files}
          pagination={{ pageSize: 15 }}
        />
      </Card>

      <Modal
        title="Advanced: enter path on the Pi"
        open={manualPathOpen}
        onOk={() => void addRootByManualPath()}
        onCancel={() => {
          setManualPathOpen(false);
          setManualPathValue("");
        }}
        okText="Add root"
        destroyOnClose
      >
        <Paragraph type="secondary" style={{ marginTop: 0 }}>
          Enter an absolute path as it exists on the Pi (Linux), e.g. <Text code>/home/pi/Videos</Text> or{" "}
          <Text code>/media/usb/Movies</Text>. File sources must be a supported video type:{" "}
          <Text code>{LOCAL_LIBRARY_VIDEO_EXT_READABLE}</Text>.
        </Paragraph>
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          <Radio.Group value={manualKind} onChange={(e) => setManualKind(e.target.value)}>
            <Radio value="folder">Folder (index everything under this path)</Radio>
            <Radio value="file">Single video file ({LOCAL_LIBRARY_VIDEO_EXT_READABLE})</Radio>
          </Radio.Group>
          <Input
            placeholder="/path/on/pi"
            value={manualPathValue}
            onChange={(e) => setManualPathValue(e.target.value)}
            onPressEnter={() => void addRootByManualPath()}
          />
        </Space>
      </Modal>

      <Modal
        title={editingRoot ? `Folder defaults — ${editingRoot.path}` : "Defaults"}
        open={rootModalOpen}
        onOk={() => void saveRootDefaults()}
        onCancel={() => {
          setRootModalOpen(false);
          setEditingRoot(null);
        }}
        destroyOnClose
      >
        <Form form={rootForm} layout="vertical">
          <Form.Item name="imdbId" label="IMDb id">
            <Input placeholder="tt1234567" />
          </Form.Item>
          <Form.Item name="type" label="Type">
            <Select allowClear options={[{ value: "movie", label: "movie" }, { value: "series", label: "series" }]} />
          </Form.Item>
          <Form.Item name="displayName" label="Display name">
            <Input />
          </Form.Item>
          <Form.Item name="language" label="Language">
            <Input placeholder="he, en, …" />
          </Form.Item>
          <Form.Item name="resolution" label="Resolution">
            <Input placeholder="1080p" />
          </Form.Item>
          <Form.Item name="year" label="Year">
            <InputNumber min={1880} max={2100} style={{ width: "100%" }} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={editingFile ? editingFile.basename : "File metadata"}
        open={fileModalOpen}
        onOk={() => void saveFileOverride()}
        onCancel={() => {
          setFileModalOpen(false);
          setEditingFile(null);
        }}
        footer={[
          <Button key="clear" danger onClick={() => void clearFileOverride()}>
            Clear overrides
          </Button>,
          <Button key="cancel" onClick={() => setFileModalOpen(false)}>
            Cancel
          </Button>,
          <Button key="ok" type="primary" onClick={() => void saveFileOverride()}>
            Save
          </Button>,
        ]}
        destroyOnClose
        width={560}
      >
        <Text type="secondary" className={styles.pathText} style={{ display: "block", marginBottom: 12 }}>
          {editingFile?.canonicalPath}
        </Text>
        <Form form={fileForm} layout="vertical">
          <Form.Item name="imdbId" label="IMDb id">
            <Input placeholder="tt1234567" />
          </Form.Item>
          <Form.Item name="type" label="Type">
            <Select allowClear options={[{ value: "movie", label: "movie" }, { value: "series", label: "series" }]} />
          </Form.Item>
          <Form.Item name="season" label="Season">
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="episode" label="Episode">
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="displayName" label="Display name">
            <Input />
          </Form.Item>
          <Form.Item name="language" label="Language">
            <Input />
          </Form.Item>
          <Form.Item name="resolution" label="Resolution">
            <Input placeholder="1080p" />
          </Form.Item>
          <Form.Item name="year" label="Year">
            <InputNumber min={1880} max={2100} style={{ width: "100%" }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

export default LocalLibrary;
