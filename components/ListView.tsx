"use client";

import ListViewContent from "./list/ListViewContent";
import { useListView, type ListViewProps } from "@/lib/use-list-view";

/**
 * Thin client wrapper: all list state and composition live in useListView and
 * ListViewContent, keeping this entrypoint stable for the project page.
 */
export default function ListView(props: ListViewProps) {
  return <ListViewContent {...useListView(props)} />;
}
