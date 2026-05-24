-- Backup/context schema provided before applying admin dashboard compatibility migration.
-- Do not run this file as a migration.

CREATE TABLE public.event (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  name text NOT NULL,
  event_description text NOT NULL DEFAULT ''::text,
  start_time timestamp with time zone,
  end_time timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  vendor_id bigint,
  display_name text NOT NULL DEFAULT ''::text,
  CONSTRAINT event_pkey PRIMARY KEY (id),
  CONSTRAINT event_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendor(id)
);
CREATE TABLE public.event_menu_mapping (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  menu_id bigint NOT NULL,
  event_id bigint NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT event_menu_mapping_pkey PRIMARY KEY (id),
  CONSTRAINT event_menu_mapping_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.event(id),
  CONSTRAINT event_menu_mapping_menu_id_fkey FOREIGN KEY (menu_id) REFERENCES public.menu(id)
);
CREATE TABLE public.line_item (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  name character varying NOT NULL,
  description text,
  menu_id bigint,
  type text,
  parent_id bigint,
  is_active boolean NOT NULL,
  display_name text NOT NULL DEFAULT ''::text,
  ingredients text,
  image text DEFAULT 'https://ctwlztrccvtxlzackzrw.supabase.co/storage/v1/object/sign/peshkash-images/paneerTikka.jpg?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV80ODEwZmM5NC02N2FmLTQ4NGEtYjdlYy0xZTk4MGI4YzA1N2EiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJwZXNoa2FzaC1pbWFnZXMvcGFuZWVyVGlra2EuanBnIiwiaWF0IjoxNzUzNDczMTA5LCJleHAiOjE3ODUwMDkxMDl9.mSE-rNWV_RfFcPN7m9kx_dOZp73DioNri8RCo94bBWw'::text,
  enum_type text,
  CONSTRAINT line_item_pkey PRIMARY KEY (id),
  CONSTRAINT line_item_menu_id_fkey FOREIGN KEY (menu_id) REFERENCES public.menu(id)
);
CREATE TABLE public.menu (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  name character varying NOT NULL,
  vendor_id bigint,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  description text,
  is_active boolean NOT NULL,
  display_name text NOT NULL DEFAULT ''::text,
  CONSTRAINT menu_pkey PRIMARY KEY (id),
  CONSTRAINT menu_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendor(id)
);
CREATE TABLE public.qr_link_mapping (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  qr_hash text,
  url text,
  updated_at timestamp with time zone DEFAULT now(),
  is_active boolean DEFAULT true,
  usage_count integer DEFAULT 0,
  expires_at timestamp with time zone,
  CONSTRAINT qr_link_mapping_pkey PRIMARY KEY (id)
);
CREATE TABLE public.vendor (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  name character varying NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  description text,
  contact ARRAY,
  address text,
  display_name text NOT NULL DEFAULT ''::text,
  has_contact_page boolean DEFAULT false,
  CONSTRAINT vendor_pkey PRIMARY KEY (id)
);
