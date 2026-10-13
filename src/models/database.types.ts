// Generated from the dev Supabase project schema (only the Database type is
// kept). Do not edit by hand: regenerate after each migration with the
// Supabase MCP generate_typescript_types tool or
// `npx supabase gen types typescript --project-id lkaurrcarzzkbqdwqfge`.

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
    PostgrestVersion: "14.17"
  }
  public: {
    Tables: {
      accounts: {
        Row: {
          closed_at: string | null
          created_at: string
          household_id: string
          id: string
          import_format: Json | null
          name: string
          on_budget: boolean
          opening_balance: number
          opening_date: string
          type: string
        }
        Insert: {
          closed_at?: string | null
          created_at?: string
          household_id: string
          id?: string
          import_format?: Json | null
          name: string
          on_budget?: boolean
          opening_balance?: number
          opening_date?: string
          type?: string
        }
        Update: {
          closed_at?: string | null
          created_at?: string
          household_id?: string
          id?: string
          import_format?: Json | null
          name?: string
          on_budget?: boolean
          opening_balance?: number
          opening_date?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounts_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          card_account_id: string | null
          created_at: string
          group_id: string
          household_id: string
          id: string
          name: string
          position: number
        }
        Insert: {
          card_account_id?: string | null
          created_at?: string
          group_id: string
          household_id: string
          id?: string
          name: string
          position?: number
        }
        Update: {
          card_account_id?: string | null
          created_at?: string
          group_id?: string
          household_id?: string
          id?: string
          name?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "categories_card_account_fkey"
            columns: ["household_id", "card_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "categories_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "categories_household_id_group_id_fkey"
            columns: ["household_id", "group_id"]
            isOneToOne: false
            referencedRelation: "category_groups"
            referencedColumns: ["household_id", "id"]
          },
        ]
      }
      category_groups: {
        Row: {
          created_at: string
          household_id: string
          id: string
          name: string
          position: number
        }
        Insert: {
          created_at?: string
          household_id: string
          id?: string
          name: string
          position?: number
        }
        Update: {
          created_at?: string
          household_id?: string
          id?: string
          name?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "category_groups_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      category_months: {
        Row: {
          assigned: number
          category_id: string
          household_id: string
          month: string
          planned: number
          released: number
        }
        Insert: {
          assigned?: number
          category_id: string
          household_id: string
          month: string
          planned?: number
          released?: number
        }
        Update: {
          assigned?: number
          category_id?: string
          household_id?: string
          month?: string
          planned?: number
          released?: number
        }
        Relationships: [
          {
            foreignKeyName: "category_months_household_id_category_id_fkey"
            columns: ["household_id", "category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["household_id", "id"]
          },
        ]
      }
      household_members: {
        Row: {
          household_id: string
          role: string
          user_id: string
        }
        Insert: {
          household_id: string
          role?: string
          user_id: string
        }
        Update: {
          household_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "household_members_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      households: {
        Row: {
          created_at: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      transaction_allocations: {
        Row: {
          amount: number
          category_id: string
          household_id: string
          id: string
          transaction_id: string
        }
        Insert: {
          amount: number
          category_id: string
          household_id: string
          id?: string
          transaction_id: string
        }
        Update: {
          amount?: number
          category_id?: string
          household_id?: string
          id?: string
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transaction_allocations_household_id_category_id_fkey"
            columns: ["household_id", "category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "transaction_allocations_household_id_transaction_id_fkey"
            columns: ["household_id", "transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["household_id", "id"]
          },
        ]
      }
      transactions: {
        Row: {
          account_id: string
          amount: number
          created_at: string
          date: string
          household_id: string
          id: string
          import_key: string | null
          is_transfer: boolean
          memo: string
          payee: string
          source: string
          transfer_id: string | null
          voided: boolean
        }
        Insert: {
          account_id: string
          amount: number
          created_at?: string
          date: string
          household_id: string
          id?: string
          import_key?: string | null
          is_transfer?: boolean
          memo?: string
          payee?: string
          source?: string
          transfer_id?: string | null
          voided?: boolean
        }
        Update: {
          account_id?: string
          amount?: number
          created_at?: string
          date?: string
          household_id?: string
          id?: string
          import_key?: string | null
          is_transfer?: boolean
          memo?: string
          payee?: string
          source?: string
          transfer_id?: string | null
          voided?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "transactions_household_id_account_id_fkey"
            columns: ["household_id", "account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "transactions_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      adjust_category_month: {
        Args: {
          p_assigned_delta?: number
          p_category_id: string
          p_month: string
          p_released_delta?: number
        }
        Returns: undefined
      }
      create_household: { Args: { p_name: string }; Returns: string }
      import_envelope_plan: {
        Args: { p_household_id: string; p_month: string; p_rows: Json }
        Returns: undefined
      }
      import_transactions: {
        Args: { p_account_id: string; p_format: Json; p_rows: Json }
        Returns: number
      }
      move_between_envelopes: {
        Args: {
          p_amount: number
          p_from_category_id: string
          p_month: string
          p_to_category_id: string
        }
        Returns: undefined
      }
      save_transaction: {
        Args: {
          p_account_id: string
          p_amount: number
          p_category_id: string
          p_date: string
          p_id: string
          p_is_transfer: boolean
          p_memo: string
          p_payee: string
        }
        Returns: string
      }
      save_transfer: {
        Args: { p_legs: Json; p_transfer_id: string }
        Returns: string
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
