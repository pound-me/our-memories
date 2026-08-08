"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { AlertTriangle, CheckCircle2, KeyRound, Plus, Save, Sparkles, Trash2 } from "lucide-react";
import { apiGet, apiPut } from "@/lib/api";
import { Button, Field, IconButton, MetricCard, Notice, PageHeader, Panel } from "@/components/admin-ui";

interface ImageGenerationNode {
  id: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
  apiKeySet?: boolean;
  model: string;
  enabled: boolean;
  priority: number;
}

interface ImageGenerationSettings {
  nodes: ImageGenerationNode[];
  avatarPromptTemplate: string;
  avatarNegativePrompt: string;
}

const emptyNode = (priority: number): ImageGenerationNode => ({
  id: "",
  name: `生图节点 ${priority + 1}`,
  baseUrl: "",
  apiKey: "",
  model: "gpt-image-2",
  enabled: true,
  priority,
});

export default function ImageGenerationPage() {
  const { data, error, mutate, isLoading } = useSWR<ImageGenerationSettings>(
    "/api/v1/admin/image-generation",
    apiGet,
  );
  const [nodes, setNodes] = useState<ImageGenerationNode[]>([]);
  const [avatarPromptTemplate, setAvatarPromptTemplate] = useState("");
  const [avatarNegativePrompt, setAvatarNegativePrompt] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ type: "success" | "warning" | "danger"; text: string } | null>(null);

  useEffect(() => {
    if (data?.nodes) {
      queueMicrotask(() => {
        setNodes(data.nodes.length > 0 ? data.nodes : [emptyNode(0)]);
        setAvatarPromptTemplate(data.avatarPromptTemplate || "");
        setAvatarNegativePrompt(data.avatarNegativePrompt || "");
      });
    }
  }, [data]);

  const enabledCount = useMemo(
    () => nodes.filter((node) => node.enabled && node.baseUrl && (node.apiKey || node.apiKeySet)).length,
    [nodes],
  );
  const configuredCount = useMemo(
    () => nodes.filter((node) => node.baseUrl && (node.apiKey || node.apiKeySet)).length,
    [nodes],
  );

  const updateNode = (index: number, patch: Partial<ImageGenerationNode>) => {
    setNodes((current) => current.map((node, nodeIndex) => (nodeIndex === index ? { ...node, ...patch } : node)));
  };

  const addNode = () => {
    setNodes((current) => [...current, emptyNode(current.length)]);
  };

  const removeNode = (index: number) => {
    setNodes((current) => current.filter((_, nodeIndex) => nodeIndex !== index));
  };

  const save = async () => {
    setSaving(true);
    setNotice(null);
    try {
      const normalized = nodes.map((node, index) => ({
        ...node,
        name: node.name.trim(),
        baseUrl: node.baseUrl.trim().replace(/\/$/, ""),
        model: node.model.trim(),
        apiKey: node.apiKey?.trim() || "",
        priority: Number.isFinite(node.priority) ? node.priority : index,
      }));
      const result = await apiPut<ImageGenerationSettings>("/api/v1/admin/image-generation", {
        nodes: normalized,
        avatarPromptTemplate,
        avatarNegativePrompt,
      });
      setNodes(result.nodes.length > 0 ? result.nodes : [emptyNode(0)]);
      setAvatarPromptTemplate(result.avatarPromptTemplate || "");
      setAvatarNegativePrompt(result.avatarNegativePrompt || "");
      await mutate(result, false);
      setNotice({ type: "success", text: "生图节点已保存。" });
    } catch {
      setNotice({ type: "danger", text: "保存失败，请检查节点配置。" });
    } finally {
      setSaving(false);
    }
  };

  if (error) {
    return <Notice type="danger">生图配置加载失败，请确认后端服务和管理员登录状态。</Notice>;
  }

  return (
    <div>
      <PageHeader
        title="生图节点"
        description="配置用于地图角色生成的 OpenAI 兼容图片接口，按优先级自动主备切换。"
        actions={
          <Button onClick={save} loading={saving} disabled={isLoading}>
            <Save size={18} />
            保存配置
          </Button>
        }
      />

      <div className="mb-6 grid grid-cols-1 gap-5 md:grid-cols-3">
        <MetricCard label="节点总数" value={nodes.length} icon={Sparkles} tone="info" />
        <MetricCard label="已配置" value={configuredCount} icon={KeyRound} tone="premium" />
        <MetricCard
          label="可用节点"
          value={enabledCount}
          icon={enabledCount > 0 ? CheckCircle2 : AlertTriangle}
          tone={enabledCount > 0 ? "success" : "warning"}
          detail={enabledCount > 0 ? "用户可生成地图角色" : "用户设置页暂不可用"}
        />
      </div>

      {(notice || enabledCount === 0) && (
        <div className="mb-5">
          <Notice type={notice?.type || "warning"}>
            {notice?.text || "还没有可用节点，用户设置页将无法生成地图角色。"}
          </Notice>
        </div>
      )}

      <div className="mb-5 rounded-lg border border-[var(--border)] bg-[var(--muted)] px-4 py-3 text-sm leading-6 text-[var(--muted-foreground)]">
        Base URL 请填写到 API 版本层级，例如 <code>https://api.example.com/v1</code>。如果图片 API
        运行在 Docker 宿主机端口，请使用 <code>http://host.docker.internal:端口/v1</code>，并确保容器启动时已加入
        <code>--add-host=host.docker.internal:host-gateway</code>。
      </div>

      <Panel
        title="角色提示词模板"
        description="用占位符拼接设置页资料和用户提示词，统一控制人物比例、地方特色和画风质量。"
        className="mb-5"
        actions={<Sparkles size={20} className="text-[var(--primary)]" />}
      >
        <div className="grid gap-4 p-5">
          <Field label="正向模板">
            <textarea
              value={avatarPromptTemplate}
              onChange={(event) => setAvatarPromptTemplate(event.target.value)}
              rows={12}
              className="min-h-64 resize-y rounded-lg border border-[var(--border)] px-4 py-3 font-mono text-xs leading-5"
            />
          </Field>
          <Field label="负面提示词">
            <textarea
              value={avatarNegativePrompt}
              onChange={(event) => setAvatarNegativePrompt(event.target.value)}
              rows={4}
              className="resize-y rounded-lg border border-[var(--border)] px-4 py-3 font-mono text-xs leading-5"
            />
          </Field>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--muted)] px-4 py-3 text-xs leading-6 text-[var(--muted-foreground)]">
            可用占位符：{"{gender}"} 性别描述、{"{prompt}"} 用户提示词、{"{reference}"} 参考图说明、
            {"{displayName}"} 用户名、{"{location}"} 设置页地点、{"{negative}"} 负面提示词。
          </div>
        </div>
      </Panel>

      <div className="space-y-4">
        {nodes.map((node, index) => (
          <Panel
            key={node.id || index}
            title={node.name || `生图节点 ${index + 1}`}
            description={`${node.apiKeySet ? "密钥已配置" : "未配置密钥"} · 优先级 ${node.priority}`}
            actions={
              <div className="flex items-center gap-2">
                <label className="inline-flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
                  <input
                    type="checkbox"
                    checked={node.enabled}
                    onChange={(event) => updateNode(index, { enabled: event.target.checked })}
                  />
                  启用
                </label>
                <IconButton label="删除节点" onClick={() => removeNode(index)} className="hover:text-rose-600">
                  <Trash2 size={18} />
                </IconButton>
              </div>
            }
          >
            <div className="grid gap-4 p-5 lg:grid-cols-2">
              <Field label="节点名称">
                <input
                  value={node.name}
                  onChange={(event) => updateNode(index, { name: event.target.value })}
                  className="rounded-lg border border-[var(--border)] px-4 py-2.5"
                />
              </Field>
              <Field label="优先级">
                <input
                  type="number"
                  value={node.priority}
                  onChange={(event) => updateNode(index, { priority: Number(event.target.value) })}
                  className="rounded-lg border border-[var(--border)] px-4 py-2.5"
                />
              </Field>
              <Field label="Base URL">
                <input
                  value={node.baseUrl}
                  placeholder="https://api.example.com/v1"
                  onChange={(event) => updateNode(index, { baseUrl: event.target.value })}
                  className="rounded-lg border border-[var(--border)] px-4 py-2.5"
                />
              </Field>
              <Field label="模型">
                <input
                  value={node.model}
                  placeholder="gpt-image-2"
                  onChange={(event) => updateNode(index, { model: event.target.value })}
                  className="rounded-lg border border-[var(--border)] px-4 py-2.5"
                />
              </Field>
              <Field label="API Key">
                <input
                  type="password"
                  value={node.apiKey || ""}
                  placeholder={node.apiKeySet ? "留空则沿用已保存密钥" : "输入节点密钥"}
                  onChange={(event) => updateNode(index, { apiKey: event.target.value })}
                  className="rounded-lg border border-[var(--border)] px-4 py-2.5"
                />
              </Field>
              <div className="flex items-end">
                <div className="flex min-h-10 items-center gap-2 rounded-lg border border-[var(--border)] px-3 text-sm text-[var(--muted-foreground)]">
                  {node.enabled ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
                  {node.enabled ? "节点参与调度" : "节点已停用"}
                </div>
              </div>
            </div>
          </Panel>
        ))}
      </div>

      <Button variant="secondary" onClick={addNode} className="mt-5">
        <Plus size={18} />
        添加备用节点
      </Button>
    </div>
  );
}
