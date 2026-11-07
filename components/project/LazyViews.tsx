"use client";

import dynamic from "next/dynamic";

/**
 * Project view components are client-only and large. Loading them through a
 * client boundary lets Turbopack emit one chunk per view instead of placing
 * every view (list, board, timeline, calendar, task pane, ...) in the project
 * route chunk.
 */
export const LazyBoardView = dynamic(() => import("../BoardView"));
export const LazyTimelineView = dynamic(() => import("../TimelineView"));
export const LazyCalendarView = dynamic(() => import("../CalendarView"));
export const LazyDashboardView = dynamic(() => import("../DashboardView"));
export const LazyMessagesView = dynamic(() => import("../MessagesView"));
export const LazyKnowledgeView = dynamic(() => import("../KnowledgeView"));
export const LazyFormsView = dynamic(() => import("../FormsView"));
export const LazyOverviewView = dynamic(() => import("../OverviewView"));
export const LazyFilesView = dynamic(() => import("../FilesView"));
export const LazyTaskPane = dynamic(() => import("../TaskPane"));
