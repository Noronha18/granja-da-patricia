export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      customer_import_batches: {
        Row: {
          actor_id: string
          created_at: string
          expected: Json
          id: string
          payload_hash: string
          result: Json | null
          source: string
        }
        Insert: {
          actor_id: string
          created_at?: string
          expected: Json
          id: string
          payload_hash: string
          result?: Json | null
          source: string
        }
        Update: {
          actor_id?: string
          created_at?: string
          expected?: Json
          id?: string
          payload_hash?: string
          result?: Json | null
          source?: string
        }
        Relationships: []
      }
      customer_openings: {
        Row: {
          actor_id: string
          as_of: string
          created_at: string
          customer_id: string
          effective_at: string
          id: string
          reason: string
          reversal_of: string | null
          signed_cents: number
        }
        Insert: {
          actor_id: string
          as_of: string
          created_at?: string
          customer_id: string
          effective_at: string
          id?: string
          reason: string
          reversal_of?: string | null
          signed_cents: number
        }
        Update: {
          actor_id?: string
          as_of?: string
          created_at?: string
          customer_id?: string
          effective_at?: string
          id?: string
          reason?: string
          reversal_of?: string | null
          signed_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "customer_openings_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_openings_reversal_of_fkey"
            columns: ["reversal_of"]
            isOneToOne: true
            referencedRelation: "customer_openings"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_prices: {
        Row: {
          customer_id: string
          price_cents: number
          product_id: string
        }
        Insert: {
          customer_id: string
          price_cents: number
          product_id: string
        }
        Update: {
          customer_id?: string
          price_cents?: number
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_prices_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_prices_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_sources: {
        Row: {
          customer_id: string
          source: string
          source_id: string
        }
        Insert: {
          customer_id: string
          source: string
          source_id: string
        }
        Update: {
          customer_id?: string
          source?: string
          source_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_sources_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          active: boolean
          address: string
          id: string
          name: string
          notes: string
          phone: string | null
          position: number
          review_pending: boolean
          source_details: Json
          version: number
          weekday: number | null
        }
        Insert: {
          active?: boolean
          address: string
          id?: string
          name: string
          notes?: string
          phone?: string | null
          position: number
          review_pending?: boolean
          source_details?: Json
          version?: number
          weekday?: number | null
        }
        Update: {
          active?: boolean
          address?: string
          id?: string
          name?: string
          notes?: string
          phone?: string | null
          position?: number
          review_pending?: boolean
          source_details?: Json
          version?: number
          weekday?: number | null
        }
        Relationships: []
      }
      delivery_corrections: {
        Row: {
          actor_id: string
          actual_result: string | null
          created_at: string
          effective_at: string
          goods_location: string | null
          id: string
          kind: string
          original_sale_id: string | null
          previous_result: string | null
          reason: string
          replacement_sale_id: string | null
          route_id: string
          stock_event_id: string | null
          stop_id: string | null
        }
        Insert: {
          actor_id: string
          actual_result?: string | null
          created_at?: string
          effective_at?: string
          goods_location?: string | null
          id?: string
          kind: string
          original_sale_id?: string | null
          previous_result?: string | null
          reason: string
          replacement_sale_id?: string | null
          route_id: string
          stock_event_id?: string | null
          stop_id?: string | null
        }
        Update: {
          actor_id?: string
          actual_result?: string | null
          created_at?: string
          effective_at?: string
          goods_location?: string | null
          id?: string
          kind?: string
          original_sale_id?: string | null
          previous_result?: string | null
          reason?: string
          replacement_sale_id?: string | null
          route_id?: string
          stock_event_id?: string | null
          stop_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "delivery_corrections_original_sale_id_fkey"
            columns: ["original_sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_corrections_replacement_sale_id_fkey"
            columns: ["replacement_sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_corrections_route_id_fkey"
            columns: ["route_id"]
            isOneToOne: false
            referencedRelation: "route_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_corrections_stock_event_id_fkey"
            columns: ["stock_event_id"]
            isOneToOne: false
            referencedRelation: "stock_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_corrections_stop_id_fkey"
            columns: ["stop_id"]
            isOneToOne: false
            referencedRelation: "route_stops"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          actor_id: string
          amount_cents: number
          category: string
          created_at: string
          description: string
          fuel_event_id: string | null
          id: string
          paid_at: string
          reversal_of: string | null
          stock_event_id: string | null
        }
        Insert: {
          actor_id: string
          amount_cents: number
          category: string
          created_at?: string
          description: string
          fuel_event_id?: string | null
          id?: string
          paid_at: string
          reversal_of?: string | null
          stock_event_id?: string | null
        }
        Update: {
          actor_id?: string
          amount_cents?: number
          category?: string
          created_at?: string
          description?: string
          fuel_event_id?: string | null
          id?: string
          paid_at?: string
          reversal_of?: string | null
          stock_event_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expenses_fuel_event_id_fkey"
            columns: ["fuel_event_id"]
            isOneToOne: true
            referencedRelation: "fuel_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_reversal_of_fkey"
            columns: ["reversal_of"]
            isOneToOne: true
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_stock_event_id_fkey"
            columns: ["stock_event_id"]
            isOneToOne: true
            referencedRelation: "stock_events"
            referencedColumns: ["id"]
          },
        ]
      }
      fuel_events: {
        Row: {
          actor_id: string
          created_at: string
          fuel_type: string
          full_tank: boolean
          id: string
          litres: number
          note: string
          occurred_at: string
          odometer_km: number
          replacement_of: string | null
          reversal_of: string | null
          total_cents: number
          vehicle_id: string
        }
        Insert: {
          actor_id: string
          created_at?: string
          fuel_type: string
          full_tank: boolean
          id?: string
          litres: number
          note?: string
          occurred_at: string
          odometer_km: number
          replacement_of?: string | null
          reversal_of?: string | null
          total_cents: number
          vehicle_id: string
        }
        Update: {
          actor_id?: string
          created_at?: string
          fuel_type?: string
          full_tank?: boolean
          id?: string
          litres?: number
          note?: string
          occurred_at?: string
          odometer_km?: number
          replacement_of?: string | null
          reversal_of?: string | null
          total_cents?: number
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fuel_events_replacement_of_fkey"
            columns: ["replacement_of"]
            isOneToOne: true
            referencedRelation: "fuel_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fuel_events_reversal_of_fkey"
            columns: ["reversal_of"]
            isOneToOne: true
            referencedRelation: "fuel_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fuel_events_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      operational_locations: {
        Row: {
          address: string | null
          confirmed: boolean
          id: string
          name: string
        }
        Insert: {
          address?: string | null
          confirmed?: boolean
          id: string
          name: string
        }
        Update: {
          address?: string | null
          confirmed?: boolean
          id?: string
          name?: string
        }
        Relationships: []
      }
      operational_settings: {
        Row: {
          driver_id: string | null
          singleton: boolean
          vehicle_id: string | null
          version: number
        }
        Insert: {
          driver_id?: string | null
          singleton?: boolean
          vehicle_id?: string | null
          version?: number
        }
        Update: {
          driver_id?: string | null
          singleton?: boolean
          vehicle_id?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "operational_settings_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operational_settings_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_allocations: {
        Row: {
          actor_id: string
          amount_cents: number
          created_at: string
          credit_opening_id: string | null
          customer_id: string
          debt_opening_id: string | null
          effective_at: string
          id: string
          payment_id: string | null
          reversal_of: string | null
          sale_id: string | null
        }
        Insert: {
          actor_id: string
          amount_cents: number
          created_at?: string
          credit_opening_id?: string | null
          customer_id: string
          debt_opening_id?: string | null
          effective_at?: string
          id?: string
          payment_id?: string | null
          reversal_of?: string | null
          sale_id?: string | null
        }
        Update: {
          actor_id?: string
          amount_cents?: number
          created_at?: string
          credit_opening_id?: string | null
          customer_id?: string
          debt_opening_id?: string | null
          effective_at?: string
          id?: string
          payment_id?: string | null
          reversal_of?: string | null
          sale_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_allocations_credit_opening_id_fkey"
            columns: ["credit_opening_id"]
            isOneToOne: false
            referencedRelation: "customer_openings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_allocations_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_allocations_debt_opening_id_fkey"
            columns: ["debt_opening_id"]
            isOneToOne: false
            referencedRelation: "customer_openings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_allocations_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_allocations_reversal_of_fkey"
            columns: ["reversal_of"]
            isOneToOne: true
            referencedRelation: "payment_allocations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_allocations_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_receipts: {
        Row: {
          actor_id: string
          created_at: string
          id: string
          mime_type: string
          object_path: string
          payment_id: string
          sha256: string
          size_bytes: number
          status: string
        }
        Insert: {
          actor_id: string
          created_at?: string
          id: string
          mime_type: string
          object_path: string
          payment_id: string
          sha256: string
          size_bytes: number
          status?: string
        }
        Update: {
          actor_id?: string
          created_at?: string
          id?: string
          mime_type?: string
          object_path?: string
          payment_id?: string
          sha256?: string
          size_bytes?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_receipts_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          actor_id: string
          amount_cents: number
          created_at: string
          customer_id: string
          id: string
          method: string
          reason: string | null
          received_at: string
          replacement_of: string | null
          reversal_of: string | null
        }
        Insert: {
          actor_id: string
          amount_cents: number
          created_at?: string
          customer_id: string
          id?: string
          method: string
          reason?: string | null
          received_at: string
          replacement_of?: string | null
          reversal_of?: string | null
        }
        Update: {
          actor_id?: string
          amount_cents?: number
          created_at?: string
          customer_id?: string
          id?: string
          method?: string
          reason?: string | null
          received_at?: string
          replacement_of?: string | null
          reversal_of?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_replacement_of_fkey"
            columns: ["replacement_of"]
            isOneToOne: true
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_reversal_of_fkey"
            columns: ["reversal_of"]
            isOneToOne: true
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          default_price_cents: number
          eggs_per_tray: number
          id: string
          name: string
        }
        Insert: {
          default_price_cents: number
          eggs_per_tray: number
          id?: string
          name: string
        }
        Update: {
          default_price_cents?: number
          eggs_per_tray?: number
          id?: string
          name?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          id: string
          role: string
        }
        Insert: {
          id: string
          role: string
        }
        Update: {
          id?: string
          role?: string
        }
        Relationships: []
      }
      route_runs: {
        Row: {
          closed_at: string | null
          declared_loss_eggs: number | null
          declared_loss_reason: string | null
          declared_return_eggs: number | null
          driver_id: string | null
          final_odometer_km: number | null
          id: string
          initial_odometer_km: number | null
          load_eggs: number
          reconciled_loss_eggs: number | null
          reconciled_return_eggs: number | null
          reconciliation_reason: string | null
          service_date: string
          started_at: string | null
          status: string
          submitted_at: string | null
          template_id: string
          vehicle_id: string | null
          version: number
        }
        Insert: {
          closed_at?: string | null
          declared_loss_eggs?: number | null
          declared_loss_reason?: string | null
          declared_return_eggs?: number | null
          driver_id?: string | null
          final_odometer_km?: number | null
          id?: string
          initial_odometer_km?: number | null
          load_eggs?: number
          reconciled_loss_eggs?: number | null
          reconciled_return_eggs?: number | null
          reconciliation_reason?: string | null
          service_date: string
          started_at?: string | null
          status?: string
          submitted_at?: string | null
          template_id: string
          vehicle_id?: string | null
          version?: number
        }
        Update: {
          closed_at?: string | null
          declared_loss_eggs?: number | null
          declared_loss_reason?: string | null
          declared_return_eggs?: number | null
          driver_id?: string | null
          final_odometer_km?: number | null
          id?: string
          initial_odometer_km?: number | null
          load_eggs?: number
          reconciled_loss_eggs?: number | null
          reconciled_return_eggs?: number | null
          reconciliation_reason?: string | null
          service_date?: string
          started_at?: string | null
          status?: string
          submitted_at?: string | null
          template_id?: string
          vehicle_id?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "route_runs_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "route_runs_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "route_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "route_runs_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      route_stops: {
        Row: {
          address: string | null
          confirmed_at: string | null
          id: string
          kind: string
          name: string
          order_id: string | null
          phone: string | null
          position: number
          reason: string | null
          route_id: string
          status: string
        }
        Insert: {
          address?: string | null
          confirmed_at?: string | null
          id?: string
          kind: string
          name: string
          order_id?: string | null
          phone?: string | null
          position: number
          reason?: string | null
          route_id: string
          status?: string
        }
        Update: {
          address?: string | null
          confirmed_at?: string | null
          id?: string
          kind?: string
          name?: string
          order_id?: string | null
          phone?: string | null
          position?: number
          reason?: string | null
          route_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "route_stops_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "weekly_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "route_stops_route_id_fkey"
            columns: ["route_id"]
            isOneToOne: false
            referencedRelation: "route_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      route_template_stops: {
        Row: {
          address: string | null
          id: string
          kind: string
          location_id: string | null
          name: string
          phone: string | null
          position: number
          template_id: string
        }
        Insert: {
          address?: string | null
          id?: string
          kind: string
          location_id?: string | null
          name: string
          phone?: string | null
          position: number
          template_id: string
        }
        Update: {
          address?: string | null
          id?: string
          kind?: string
          location_id?: string | null
          name?: string
          phone?: string | null
          position?: number
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "route_template_stops_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "operational_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "route_template_stops_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "route_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      route_templates: {
        Row: {
          destination_location_id: string | null
          driver_id: string | null
          id: string
          name: string
          origin_location_id: string | null
          vehicle_id: string | null
          weekday: number
        }
        Insert: {
          destination_location_id?: string | null
          driver_id?: string | null
          id?: string
          name: string
          origin_location_id?: string | null
          vehicle_id?: string | null
          weekday: number
        }
        Update: {
          destination_location_id?: string | null
          driver_id?: string | null
          id?: string
          name?: string
          origin_location_id?: string | null
          vehicle_id?: string | null
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "route_templates_destination_location_id_fkey"
            columns: ["destination_location_id"]
            isOneToOne: false
            referencedRelation: "operational_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "route_templates_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "route_templates_origin_location_id_fkey"
            columns: ["origin_location_id"]
            isOneToOne: false
            referencedRelation: "operational_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "route_templates_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      sales: {
        Row: {
          actor_id: string
          amount_cents: number
          cost_cents: number | null
          created_at: string
          customer_id: string
          due_at: string | null
          effective_at: string
          eggs: number
          id: string
          items: Json
          order_id: string | null
          reason: string | null
          replacement_of: string | null
          reversal_of: string | null
          stop_id: string | null
        }
        Insert: {
          actor_id: string
          amount_cents: number
          cost_cents?: number | null
          created_at?: string
          customer_id: string
          due_at?: string | null
          effective_at: string
          eggs: number
          id?: string
          items?: Json
          order_id?: string | null
          reason?: string | null
          replacement_of?: string | null
          reversal_of?: string | null
          stop_id?: string | null
        }
        Update: {
          actor_id?: string
          amount_cents?: number
          cost_cents?: number | null
          created_at?: string
          customer_id?: string
          due_at?: string | null
          effective_at?: string
          eggs?: number
          id?: string
          items?: Json
          order_id?: string | null
          reason?: string | null
          replacement_of?: string | null
          reversal_of?: string | null
          stop_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "weekly_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_replacement_of_fkey"
            columns: ["replacement_of"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_reversal_of_fkey"
            columns: ["reversal_of"]
            isOneToOne: true
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_stop_id_fkey"
            columns: ["stop_id"]
            isOneToOne: false
            referencedRelation: "route_stops"
            referencedColumns: ["id"]
          },
        ]
      }
      standing_order_items: {
        Row: {
          customer_id: string
          product_id: string
          trays: number
        }
        Insert: {
          customer_id: string
          product_id: string
          trays: number
        }
        Update: {
          customer_id?: string
          product_id?: string
          trays?: number
        }
        Relationships: [
          {
            foreignKeyName: "standing_order_items_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "standing_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_balances: {
        Row: {
          balance_key: string
          eggs: number
          location: string
          route_id: string | null
          total_cost_cents: number | null
          unit_cost_cents: number | null
          vehicle_id: string | null
        }
        Insert: {
          balance_key: string
          eggs?: number
          location: string
          route_id?: string | null
          total_cost_cents?: number | null
          unit_cost_cents?: number | null
          vehicle_id?: string | null
        }
        Update: {
          balance_key?: string
          eggs?: number
          location?: string
          route_id?: string | null
          total_cost_cents?: number | null
          unit_cost_cents?: number | null
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_balances_route_id_fkey"
            columns: ["route_id"]
            isOneToOne: true
            referencedRelation: "route_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_balances_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_events: {
        Row: {
          actor_id: string
          cost_cents: number | null
          created_at: string
          direction: string
          effective_at: string
          eggs: number
          id: string
          kind: string
          location: string
          reason: string | null
          reversal_of: string | null
          route_id: string | null
          source_event_id: string | null
          unit_cost_cents: number | null
        }
        Insert: {
          actor_id: string
          cost_cents?: number | null
          created_at?: string
          direction: string
          effective_at: string
          eggs: number
          id?: string
          kind: string
          location: string
          reason?: string | null
          reversal_of?: string | null
          route_id?: string | null
          source_event_id?: string | null
          unit_cost_cents?: number | null
        }
        Update: {
          actor_id?: string
          cost_cents?: number | null
          created_at?: string
          direction?: string
          effective_at?: string
          eggs?: number
          id?: string
          kind?: string
          location?: string
          reason?: string | null
          reversal_of?: string | null
          route_id?: string | null
          source_event_id?: string | null
          unit_cost_cents?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_events_reversal_of_fkey"
            columns: ["reversal_of"]
            isOneToOne: false
            referencedRelation: "stock_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_events_route_id_fkey"
            columns: ["route_id"]
            isOneToOne: false
            referencedRelation: "route_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicles: {
        Row: {
          id: string
          name: string
        }
        Insert: {
          id?: string
          name: string
        }
        Update: {
          id?: string
          name?: string
        }
        Relationships: []
      }
      weekly_order_items: {
        Row: {
          eggs_per_tray: number
          order_id: string
          price_cents: number
          product_id: string
          trays: number
        }
        Insert: {
          eggs_per_tray: number
          order_id: string
          price_cents: number
          product_id: string
          trays: number
        }
        Update: {
          eggs_per_tray?: number
          order_id?: string
          price_cents?: number
          product_id?: string
          trays?: number
        }
        Relationships: [
          {
            foreignKeyName: "weekly_order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "weekly_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      weekly_orders: {
        Row: {
          customer_address: string
          customer_id: string
          customer_name: string
          customer_phone: string | null
          delivery_date: string
          id: string
          route_id: string
          status: string
          version: number
        }
        Insert: {
          customer_address: string
          customer_id: string
          customer_name: string
          customer_phone?: string | null
          delivery_date: string
          id?: string
          route_id: string
          status?: string
          version?: number
        }
        Update: {
          customer_address?: string
          customer_id?: string
          customer_name?: string
          customer_phone?: string | null
          delivery_date?: string
          id?: string
          route_id?: string
          status?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "weekly_orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_orders_route_id_fkey"
            columns: ["route_id"]
            isOneToOne: false
            referencedRelation: "route_runs"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      cancel_route: {
        Args: {
          p_expected_version: number
          p_reason: string
          p_request_id: string
          p_route_id: string
        }
        Returns: Json
      }
      commit_customer_import: {
        Args: { p_batch_id: string; p_request_id: string; p_rows: Json }
        Returns: Json
      }
      complete_payment_receipt: { Args: { p_id: string }; Returns: undefined }
      confirm_route_load: {
        Args: {
          p_expected_version: number
          p_request_id: string
          p_route_id: string
        }
        Returns: Json
      }
      correct_delivery_record: {
        Args: {
          p_actual_result: string
          p_goods_location: string
          p_reason: string
          p_request_id: string
          p_stop_id: string
        }
        Returns: Json
      }
      correct_expense: {
        Args: {
          p_expense_id: string
          p_reason: string
          p_replacement: Json
          p_request_id: string
        }
        Returns: Json
      }
      correct_fuel: {
        Args: {
          p_fuel_id: string
          p_reason: string
          p_replacement: Json
          p_request_id: string
        }
        Returns: Json
      }
      correct_payment: {
        Args: {
          p_payment_id: string
          p_reason: string
          p_replacement: Json
          p_request_id: string
        }
        Returns: Json
      }
      correct_sale_price: {
        Args: {
          p_prices: Json
          p_reason: string
          p_request_id: string
          p_sale_id: string
        }
        Returns: Json
      }
      dashboard_summary: { Args: { p_date: string }; Returns: Json }
      financial_summary: {
        Args: { p_as_of?: string; p_from: string; p_to: string }
        Returns: Json
      }
      generate_week: {
        Args: { p_request_id: string; p_week_start: string }
        Returns: Json
      }
      get_customer_account: { Args: { p_customer_id: string }; Returns: Json }
      get_customer_balances: { Args: never; Returns: Json }
      get_customer_positions: {
        Args: {
          p_as_of?: string
          p_limit?: number
          p_offset?: number
          p_search?: string
          p_to: string
        }
        Returns: Json
      }
      get_driver_route: { Args: { p_service_date: string }; Returns: Json }
      get_fuel_history: { Args: never; Returns: Json }
      get_fuel_vehicles: { Args: never; Returns: Json }
      get_my_stock: { Args: never; Returns: Json }
      get_operational_settings: { Args: never; Returns: Json }
      get_payment_receipt_orphans: { Args: never; Returns: Json }
      get_request_result: { Args: { p_request_id: string }; Returns: Json }
      get_route_distance_context: {
        Args: {
          p_expected_version: number
          p_reserve?: boolean
          p_route_id: string
        }
        Returns: Json
      }
      get_route_options: { Args: never; Returns: Json }
      mark_receipt_orphan_removed: {
        Args: { p_path: string }
        Returns: boolean
      }
      prepare_customer_import: {
        Args: { p_batch_id: string; p_rows: Json; p_source: string }
        Returns: Json
      }
      reconcile_configuration_request: {
        Args: { p_operation: string; p_request_id: string }
        Returns: Json
      }
      reconcile_customer_request: {
        Args: { p_request_id: string }
        Returns: Json
      }
      reconcile_expense_request: {
        Args: { p_operation?: string; p_request_id: string }
        Returns: Json
      }
      reconcile_fuel_request: {
        Args: { p_operation?: string; p_request_id: string }
        Returns: Json
      }
      reconcile_payment_request: {
        Args: { p_operation: string; p_request_id: string }
        Returns: Json
      }
      reconcile_preparation_request: {
        Args: { p_operation: string; p_request_id: string }
        Returns: Json
      }
      reconcile_route: {
        Args: {
          p_expected_version: number
          p_loss_eggs: number
          p_reason: string
          p_request_id: string
          p_return_eggs: number
          p_route_id: string
        }
        Returns: Json
      }
      reconcile_route_request: {
        Args: { p_operation: string; p_request_id: string }
        Returns: Json
      }
      reconcile_stock_request: {
        Args: { p_operation?: string; p_request_id: string }
        Returns: Json
      }
      record_delivery: {
        Args: {
          p_reason: string
          p_request_id: string
          p_result: string
          p_stop_id: string
        }
        Returns: Json
      }
      record_expense: {
        Args: { p_event: Json; p_request_id: string }
        Returns: Json
      }
      record_fuel: {
        Args: { p_event: Json; p_request_id: string }
        Returns: Json
      }
      record_operational_stop: {
        Args: { p_request_id: string; p_stop_id: string }
        Returns: Json
      }
      record_payment: {
        Args: {
          p_amount_cents: number
          p_customer_id: string
          p_method: string
          p_received_at: string
          p_request_id: string
        }
        Returns: Json
      }
      record_stock_event: {
        Args: { p_event: Json; p_request_id: string }
        Returns: Json
      }
      reopen_preparation: {
        Args: {
          p_expected_version: number
          p_reason: string
          p_request_id: string
          p_route_id: string
        }
        Returns: Json
      }
      reserve_payment_receipt: {
        Args: {
          p_actor_id: string
          p_id: string
          p_mime: string
          p_path: string
          p_payment_id: string
          p_sha256: string
          p_size: number
        }
        Returns: string
      }
      save_customer: {
        Args: {
          p_customer_id: string
          p_details: Json
          p_expected_version: number
          p_items: Json
          p_prices: Json
          p_request_id: string
        }
        Returns: Json
      }
      save_operational_settings: {
        Args: {
          p_expected_version: number
          p_request_id: string
          p_settings: Json
        }
        Returns: Json
      }
      save_route_run: {
        Args: {
          p_driver_id: string
          p_expected_version: number
          p_request_id: string
          p_route_id: string
          p_stop_ids: string[]
          p_vehicle_id: string
        }
        Returns: Json
      }
      save_weekly_order: {
        Args: {
          p_expected_version: number
          p_items: Json
          p_order_id: string
          p_request_id: string
          p_suspended: boolean
        }
        Returns: Json
      }
      set_opening_balance: {
        Args: {
          p_as_of: string
          p_customer_id: string
          p_reason: string
          p_request_id: string
          p_signed_cents: number
        }
        Returns: Json
      }
      set_remaining_stock_cost: {
        Args: {
          p_location: string
          p_reason: string
          p_request_id: string
          p_total_cost_cents: number
        }
        Returns: Json
      }
      start_route: {
        Args: {
          p_expected_version: number
          p_odometer: number
          p_request_id: string
          p_route_id: string
        }
        Returns: Json
      }
      submit_route_return: {
        Args: {
          p_loss_eggs: number
          p_loss_reason: string
          p_odometer: number
          p_request_id: string
          p_return_eggs: number
          p_route_id: string
        }
        Returns: Json
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
    Enums: {},
  },
} as const
