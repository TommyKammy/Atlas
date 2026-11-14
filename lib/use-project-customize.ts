"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { ProjectRule } from "./automation/types";
import type { Bundle } from "./bundles";
import type { CustomField } from "./custom-fields";
import { projectDrawerTop } from "./drawer-position";
import { canConfigureProject } from "./project-policy";
import { canEditProject, canManageProject, type ProjectRole } from "./project-roles";

import { useCustomizeApps } from "./project-customize/use-customize-apps";
import { useCustomizeBundles } from "./project-customize/use-customize-bundles";
import { useCustomizeEmail } from "./project-customize/use-customize-email";
import { fetchFields, useCustomizeFields } from "./project-customize/use-customize-fields";
import { useCustomizeStatus } from "./project-customize/use-customize-status";
import { fetchTemplates, useCustomizeTemplates } from "./project-customize/use-customize-templates";

export type CustomizePanel =
  | "home"
  | "appearance"
  | "status"
  | "fields"
  | "templates"
  | "email"
  | "apps"
  | "bundles"
  | "automations";

/** Compose feature editors while preserving the drawer lifecycle and public API. */
export function useProjectCustomize({
  projectId,
  initialColor,
  initialIcon,
  initialStatusOptions,
  initialStatusOptionsVersion,
  initialStatusFieldName,
  initialStatusFieldEnabled,
  initialFields,
  initialEmailAddress,
  initialEmailEnabled,
  initialBundles,
  initialRules,
  role,
  projectSettings,
}: {
  projectId: number;
  initialColor: string | null;
  initialIcon: string | null;
  initialStatusOptions: string[];
  initialStatusOptionsVersion: number;
  initialStatusFieldName: string;
  initialStatusFieldEnabled: boolean;
  initialFields: CustomField[];
  initialEmailAddress: string | null;
  initialEmailEnabled: boolean;
  initialBundles: Bundle[];
  initialRules: ProjectRule[];
  role: ProjectRole;
  projectSettings?: unknown;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [panelTop, setPanelTop] = useState(0);
  const [panel, setPanel] = useState<CustomizePanel>("home");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const toastTimer = useRef<number | null>(null);

  const canEdit = canEditProject(role);
  const canConfigure = canConfigureProject(role, projectSettings);
  const canAdmin = canManageProject(role);

  const notify = (message: string) => {
    setToast(message);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 2400);
  };

  const context = { projectId, canConfigure, canEdit, canAdmin, busy, setBusy, notify, refresh: () => router.refresh() };
  const { color, icon, statusFieldName, setStatusFieldName, statusFieldEnabled, statusDrafts, setStatusDrafts,
    statusKey, statusValues, saveAppearance, saveStatusOptions, deleteStatusField, restoreStatusField } = useCustomizeStatus({
      ...context, initialColor, initialIcon, initialStatusOptions, initialStatusOptionsVersion, initialStatusFieldName, initialStatusFieldEnabled, setPanel,
    });
  const { fields, setFields, fieldDraft, setFieldDraft, saveField, removeField, addLibraryField } = useCustomizeFields({ ...context, initialFields });
  const { templates, setTemplates, templateDraft, setTemplateDraft, saveTemplate, instantiateTemplate, removeTemplate } = useCustomizeTemplates(context);
  const { bundleDraft, setBundleDraft, applyBundle, saveBundle, removeBundle } = useCustomizeBundles({ ...context, initialBundles, initialRules });
  const { appDraft, setAppDraft, installApp, toggleApp, removeApp } = useCustomizeApps(context);
  const { emailAddress, setEmailAddress, emailEnabled, setEmailEnabled, emailCopied, updateEmail, copyEmail } = useCustomizeEmail({ ...context, initialEmailAddress, initialEmailEnabled });

  useEffect(() => {
    if (!open) return;
    const onResize = () => setPanelTop(projectDrawerTop());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      const [nextFields, nextTemplates, emailRes] = await Promise.all([
        fetchFields(projectId),
        fetchTemplates(projectId),
        fetch(`/api/projects/${projectId}/email`),
      ]);
      if (!cancelled) {
        setFields(nextFields);
        setTemplates(nextTemplates);
        if (emailRes.ok) {
          const email = (await emailRes.json()) as { address?: string; enabled?: boolean };
          if (email.address) setEmailAddress(email.address);
          setEmailEnabled(email.enabled !== false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, projectId, setEmailAddress, setEmailEnabled, setFields, setTemplates]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (fieldDraft) {
        setFieldDraft(null);
        return;
      }
      if (templateDraft) {
        setTemplateDraft(null);
        return;
      }
      setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, fieldDraft, templateDraft, setFieldDraft, setTemplateDraft]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [panel]);

  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ panel?: CustomizePanel }>).detail;
      setPanelTop(projectDrawerTop());
      setPanel(detail?.panel === "status" || detail?.panel === "fields" ? detail.panel : "home");
      setOpen(true);
    };
    window.addEventListener("atlas:open-customize", onOpen);
    return () => window.removeEventListener("atlas:open-customize", onOpen);
  }, []);

  useEffect(
    () => () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    },
    [],
  );

  const toggleDrawer = () => {
    if (open) {
      setOpen(false);
      return;
    }
    setPanelTop(projectDrawerTop());
    setPanel("home");
    setOpen(true);
  };

  return {
    open,
    setOpen,
    panelTop,
    panel,
    setPanel,
    color,
    icon,
    statusFieldName,
    setStatusFieldName,
    statusFieldEnabled,
    statusDrafts,
    setStatusDrafts,
    statusKey,
    fields,
    templates,
    fieldDraft,
    setFieldDraft,
    templateDraft,
    setTemplateDraft,
    emailAddress,
    emailEnabled,
    emailCopied,
    appDraft,
    setAppDraft,
    bundleDraft,
    setBundleDraft,
    busy,
    toast,
    scrollRef,
    canEdit,
    canConfigure,
    canAdmin,
    statusValues,
    notify,
    saveAppearance,
    saveStatusOptions,
    deleteStatusField,
    restoreStatusField,
    saveField,
    removeField,
    addLibraryField,
    saveTemplate,
    instantiateTemplate,
    removeTemplate,
    applyBundle,
    saveBundle,
    removeBundle,
    installApp,
    toggleApp,
    removeApp,
    updateEmail,
    copyEmail,
    toggleDrawer,
  };
}

export type ProjectCustomizeState = ReturnType<typeof useProjectCustomize>;
