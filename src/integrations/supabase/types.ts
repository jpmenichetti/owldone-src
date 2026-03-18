export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      admin_stats_daily: {
        Row: {
          computed_at: string
          id: string
          stat_date: string
          todos_completed: number
          todos_created: number
          unique_users: number
        }
        Insert: {
          computed_at?: string
          id?: string
          stat_date: string
          todos_completed?: number
          todos_created?: number
          unique_users?: number
        }
        Update: {
          computed_at?: string
          id?: string
          stat_date?: string
          todos_completed?: number
          todos_created?: number
          unique_users?: number
        }
        Relationships: []
      }
      admin_stats_summary: {
        Row: {
          computed_at: string
          id: number
          todos_next_week_count: number
          todos_others_count: number
          todos_this_week_count: number
          todos_today_count: number
          total_todos: number
          total_users: number
        }
        Insert: {
          computed_at?: string
          id?: number
          todos_next_week_count?: number
          todos_others_count?: number
          todos_this_week_count?: number
          todos_today_count?: number
          total_todos?: number
          total_users?: number
        }
        Update: {
          computed_at?: string
          id?: number
          todos_next_week_count?: number
          todos_others_count?: number
          todos_this_week_count?: number
          todos_today_count?: number
          total_todos?: number
          total_users?: number
        }
        Relationships: []
      }
      api_latency_logs: {
        Row: {
          action: string
          created_at: string
          duration_ms: number
          function_name: string
          id: string
          status_code: number
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          duration_ms: number
          function_name: string
          id?: string
          status_code?: number
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          duration_ms?: number
          function_name?: string
          id?: string
          status_code?: number
          user_id?: string | null
        }
        Relationships: []
      }
      todo_images: {
        Row: {
          file_name: string
          id: string
          storage_path: string
          todo_id: string
          uploaded_at: string
        }
        Insert: {
          file_name?: string
          id?: string
          storage_path: string
          todo_id: string
          uploaded_at?: string
        }
        Update: {
          file_name?: string
          id?: string
          storage_path?: string
          todo_id?: string
          uploaded_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "todo_images_todo_id_fkey"
            columns: ["todo_id"]
            isOneToOne: false
            referencedRelation: "todos"
            referencedColumns: ["id"]
          },
        ]
      }
      todos: {
        Row: {
          category: string
          completed: boolean
          completed_at: string | null
          created_at: string
          id: string
          next_recurrence_at: string | null
          notes: string | null
          recurrence: string | null
          recurring_source_id: string | null
          removed: boolean
          removed_at: string | null
          tags: string[] | null
          text: string
          updated_at: string
          urls: string[] | null
          user_id: string
        }
        Insert: {
          category: string
          completed?: boolean
          completed_at?: string | null
          created_at?: string
          id?: string
          next_recurrence_at?: string | null
          notes?: string | null
          recurrence?: string | null
          recurring_source_id?: string | null
          removed?: boolean
          removed_at?: string | null
          tags?: string[] | null
          text: string
          updated_at?: string
          urls?: string[] | null
          user_id: string
        }
        Update: {
          category?: string
          completed?: boolean
          completed_at?: string | null
          created_at?: string
          id?: string
          next_recurrence_at?: string | null
          notes?: string | null
          recurrence?: string | null
          recurring_source_id?: string | null
          removed?: boolean
          removed_at?: string | null
          tags?: string[] | null
          text?: string
          updated_at?: string
          urls?: string[] | null
          user_id?: string
        }
        Relationships: []
      }
      user_features: {
        Row: {
          created_at: string
          enabled: boolean
          expires_at: string | null
          feature: string
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          expires_at?: string | null
          feature: string
          id?: string
          user_id: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          expires_at?: string | null
          feature?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      user_filters: {
        Row: {
          created_at: string
          id: string
          selected_tags: string[]
          show_overdue: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          selected_tags?: string[]
          show_overdue?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          selected_tags?: string[]
          show_overdue?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_preferences: {
        Row: {
          created_at: string
          id: string
          language: string
          onboarding_completed: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          language?: string
          onboarding_completed?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          language?: string
          onboarding_completed?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      weekly_reports: {
        Row: {
          created_at: string
          id: string
          summary: string
          todos_count: number
          user_id: string
          week_end: string
          week_start: string
        }
        Insert: {
          created_at?: string
          id?: string
          summary: string
          todos_count?: number
          user_id: string
          week_end: string
          week_start: string
        }
        Update: {
          created_at?: string
          id?: string
          summary?: string
          todos_count?: number
          user_id?: string
          week_end?: string
          week_start?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      compute_admin_stats: { Args: never; Returns: undefined }
      count_archived_todos: { Args: { search_term: string }; Returns: number }
      get_latency_stats: {
        Args: { p_date_from: string; p_date_to: string }
        Returns: {
          action: string
          avg_ms: number
          call_count: number
          function_name: string
          p50_ms: number
          p95_ms: number
          p99_ms: number
        }[]
      }
      get_latency_timeseries: {
        Args: { p_date_from: string; p_date_to: string; p_granularity?: string }
        Returns: {
          avg_ms: number
          bucket: string
          call_count: number
          function_name: string
          p95_ms: number
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      purge_old_latency_logs: { Args: never; Returns: undefined }
      search_archived_todos: {
        Args: { page_offset: number; page_size: number; search_term: string }
        Returns: {
          category: string
          completed: boolean
          completed_at: string | null
          created_at: string
          id: string
          next_recurrence_at: string | null
          notes: string | null
          recurrence: string | null
          recurring_source_id: string | null
          removed: boolean
          removed_at: string | null
          tags: string[] | null
          text: string
          updated_at: string
          urls: string[] | null
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "todos"
          isOneToOne: false
          isSetofReturn: true
        }
      }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "moderator", "user"],
    },
  },
} as const
