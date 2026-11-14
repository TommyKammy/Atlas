"use client";

import { QuickTaskProvider, useQuickTasks } from "./task/QuickTaskContext";
import ListViewContent from "./list/ListViewContent";
import { useListView, type ListViewProps } from "@/lib/use-list-view";

/**
 * Thin client wrapper: all list state and composition live in useListView and
 * ListViewContent, keeping this entrypoint stable for the project page.
 */
function ListClient(props: ListViewProps) {
  const tasks = useQuickTasks(props.tasks);
  return <ListViewContent {...useListView({ ...props, tasks })} />;
}
export default function ListView(props: ListViewProps) {
  return <QuickTaskProvider key={props.projectId} projectId={props.projectId} sections={props.sections} view="list" canEdit={props.canEdit}>
    <ListClient {...props} />
  </QuickTaskProvider>;
}
