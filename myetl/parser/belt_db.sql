--
-- PostgreSQL database dump
--

\restrict ZePjU11UjJtULP13xP0LbAoDAsff5TzlJ4mox23WzVgWpfhllpzNhj4qF7L5J85

-- Dumped from database version 14.23 (Debian 14.23-1.pgdg13+1)
-- Dumped by pg_dump version 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1)

-- Started on 2026-09-07 19:08:24 MSK

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- TOC entry 4 (class 2615 OID 2200)
-- Name: public; Type: SCHEMA; Schema: -; Owner: postgres
--

-- *not* creating schema, since initdb creates it


ALTER SCHEMA public OWNER TO postgres;

--
-- TOC entry 239 (class 1255 OID 16385)
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
NEW.updated_at = now();
RETURN NEW;
END;
$$;


ALTER FUNCTION public.update_updated_at_column() OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- TOC entry 236 (class 1259 OID 16554)
-- Name: app_users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.app_users (
    id bigint NOT NULL,
    issuer text NOT NULL,
    subject text NOT NULL
);


ALTER TABLE public.app_users OWNER TO postgres;

--
-- TOC entry 235 (class 1259 OID 16553)
-- Name: app_users_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.app_users ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.app_users_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 209 (class 1259 OID 16386)
-- Name: chain_run; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.chain_run (
    id bigint NOT NULL,
    chain_id bigint NOT NULL,
    started_at timestamp without time zone DEFAULT now(),
    finished_at timestamp without time zone,
    started_by bigint,
    status text DEFAULT 'running'::text,
    error_text text,
    stdout text,
    stderr text,
    object_type text DEFAULT 'chain'::text,
    object_id bigint,
    updated_at timestamp without time zone DEFAULT now(),
    version integer
);


ALTER TABLE public.chain_run OWNER TO postgres;

--
-- TOC entry 210 (class 1259 OID 16395)
-- Name: chain_run_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.chain_run_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.chain_run_id_seq OWNER TO postgres;

--
-- TOC entry 3574 (class 0 OID 0)
-- Dependencies: 210
-- Name: chain_run_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.chain_run_id_seq OWNED BY public.chain_run.id;


--
-- TOC entry 211 (class 1259 OID 16396)
-- Name: connections; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.connections (
    id integer NOT NULL,
    workspace_id integer DEFAULT 1,
    name text,
    config jsonb,
    secret jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    connection_type text DEFAULT 'postgres'::text NOT NULL,
    updated_by bigint
);


ALTER TABLE public.connections OWNER TO postgres;

--
-- TOC entry 212 (class 1259 OID 16405)
-- Name: connections2_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.connections2_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.connections2_id_seq OWNER TO postgres;

--
-- TOC entry 3575 (class 0 OID 0)
-- Dependencies: 212
-- Name: connections2_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.connections2_id_seq OWNED BY public.connections.id;


--
-- TOC entry 213 (class 1259 OID 16406)
-- Name: flow_run; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.flow_run (
    id bigint NOT NULL,
    chain_run_id bigint,
    chain_id bigint,
    flow_id bigint NOT NULL,
    status text DEFAULT 'running'::text NOT NULL,
    started_at timestamp without time zone DEFAULT now(),
    finished_at timestamp without time zone,
    started_by bigint,
    error_text text,
    stdout text,
    stderr text,
    updated_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.flow_run OWNER TO postgres;

--
-- TOC entry 214 (class 1259 OID 16414)
-- Name: flow_run_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.flow_run_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.flow_run_id_seq OWNER TO postgres;

--
-- TOC entry 3576 (class 0 OID 0)
-- Dependencies: 214
-- Name: flow_run_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.flow_run_id_seq OWNED BY public.flow_run.id;


--
-- TOC entry 215 (class 1259 OID 16415)
-- Name: flows; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.flows (
    id integer NOT NULL,
    workspace_id integer DEFAULT 1,
    name text,
    data jsonb,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by bigint
);


ALTER TABLE public.flows OWNER TO postgres;

--
-- TOC entry 216 (class 1259 OID 16422)
-- Name: flows2_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.flows2_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.flows2_id_seq OWNER TO postgres;

--
-- TOC entry 3577 (class 0 OID 0)
-- Dependencies: 216
-- Name: flows2_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.flows2_id_seq OWNED BY public.flows.id;


--
-- TOC entry 217 (class 1259 OID 16423)
-- Name: journal_table; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.journal_table (
    id integer NOT NULL,
    chain_id smallint,
    flow_id smallint,
    chain_run_id integer,
    etl_type text,
    flow_type text,
    add_info jsonb,
    target_connection_id smallint,
    target_connection_type text,
    source text,
    target text,
    start_at timestamp with time zone,
    end_at timestamp with time zone,
    status text,
    source_request_id text,
    request_id timestamp with time zone,
    batch_id smallint,
    rows_count integer,
    text_error text,
    flow_run_id integer
);


ALTER TABLE public.journal_table OWNER TO postgres;

--
-- TOC entry 218 (class 1259 OID 16428)
-- Name: process_chains; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.process_chains (
    id integer NOT NULL,
    workspace_id integer DEFAULT 1,
    ugroup smallint,
    guser integer,
    name text,
    data jsonb,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    updated_by bigint
);


ALTER TABLE public.process_chains OWNER TO postgres;

--
-- TOC entry 219 (class 1259 OID 16435)
-- Name: journal_chain; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.journal_chain AS
 SELECT j.chain_id AS id,
    pc.name AS chain_name,
    max(j.id) AS last_run_id,
    to_char(max(j.start_at), 'YYYY-MM-DD HH24:MI:SS'::text) AS last_run_at,
    (array_agg(j.status ORDER BY j.start_at DESC, j.id DESC))[1] AS status,
    count(*) FILTER (WHERE (j.status = 'fail'::text)) AS error,
    count(*) FILTER (WHERE (j.status = 'running'::text)) AS running,
    count(*) FILTER (WHERE (j.status = 'success'::text)) AS success
   FROM (public.journal_table j
     LEFT JOIN public.process_chains pc ON ((pc.id = j.chain_id)))
  WHERE (j.target_connection_id = 1)
  GROUP BY j.chain_id, pc.name
  ORDER BY (max(j.start_at)) DESC;


ALTER VIEW public.journal_chain OWNER TO postgres;

--
-- TOC entry 220 (class 1259 OID 16440)
-- Name: journal_chain_flow; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.journal_chain_flow AS
 SELECT jt.flow_id AS id,
    jt.chain_id,
    jt.flow_id,
    max(jt.etl_type) AS etl_type,
    max(jt.flow_type) AS flow_type,
    max(jt.start_at) AS last_run_at,
        CASE
            WHEN (count(*) FILTER (WHERE (jt.status = 'fail'::text)) > 0) THEN 'error'::text
            WHEN (count(*) FILTER (WHERE (jt.end_at IS NULL)) > 0) THEN 'running'::text
            ELSE 'success'::text
        END AS status,
    count(DISTINCT jt.request_id) FILTER (WHERE (jt.status = 'fail'::text)) AS errors,
    count(DISTINCT jt.request_id) FILTER (WHERE (jt.end_at IS NULL)) AS running,
    ((count(DISTINCT jt.request_id) - count(DISTINCT jt.request_id) FILTER (WHERE (jt.status = 'fail'::text))) - count(DISTINCT jt.request_id) FILTER (WHERE (jt.end_at IS NULL))) AS success,
    count(*) AS operations,
    sum(COALESCE(jt.rows_count, 0)) AS rows
   FROM public.journal_table jt
  WHERE (jt.flow_id IS NOT NULL)
  GROUP BY jt.chain_id, jt.flow_id;


ALTER VIEW public.journal_chain_flow OWNER TO postgres;

--
-- TOC entry 221 (class 1259 OID 16445)
-- Name: journal_flow_nodes; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.journal_flow_nodes AS
 SELECT jt.id,
    jt.chain_id,
    jt.flow_id,
    jt.chain_run_id,
    jt.etl_type,
    jt.flow_type,
    jt.source,
    jt.target,
    jt.start_at,
    jt.end_at,
        CASE
            WHEN (jt.status = 'fail'::text) THEN 'error'::text
            ELSE jt.status
        END AS status,
    jt.source_request_id,
    jt.request_id,
    jt.batch_id,
    jt.rows_count,
    jt.text_error,
    jt.add_info
   FROM public.journal_table jt
  WHERE (jt.flow_id IS NOT NULL)
  ORDER BY jt.start_at DESC, jt.id DESC;


ALTER VIEW public.journal_flow_nodes OWNER TO postgres;

--
-- TOC entry 222 (class 1259 OID 16450)
-- Name: journal_table_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.journal_table_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.journal_table_id_seq OWNER TO postgres;

--
-- TOC entry 3578 (class 0 OID 0)
-- Dependencies: 222
-- Name: journal_table_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.journal_table_id_seq OWNED BY public.journal_table.id;


--
-- TOC entry 223 (class 1259 OID 16451)
-- Name: monitor_chain_runs; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.monitor_chain_runs AS
 SELECT chain_run.id,
    chain_run.chain_id,
    chain_run.status,
    chain_run.started_at,
    chain_run.finished_at,
    chain_run.error_text,
    chain_run.stdout,
    chain_run.stderr
   FROM public.chain_run;


ALTER VIEW public.monitor_chain_runs OWNER TO postgres;

--
-- TOC entry 224 (class 1259 OID 16455)
-- Name: process_chain_schedules; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.process_chain_schedules (
    id integer NOT NULL,
    chain_id integer NOT NULL,
    cron_expr text NOT NULL,
    timezone text DEFAULT 'Europe/Moscow'::text NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    next_run_at timestamp with time zone,
    last_run_at timestamp with time zone,
    last_status text,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by bigint
);


ALTER TABLE public.process_chain_schedules OWNER TO postgres;

--
-- TOC entry 225 (class 1259 OID 16464)
-- Name: monitor_chains; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.monitor_chains AS
 WITH run_agg AS (
         SELECT chain_run.chain_id,
            count(*) FILTER (WHERE (chain_run.status = 'success'::text)) AS success,
            count(*) FILTER (WHERE (chain_run.status = 'error'::text)) AS error,
            count(*) FILTER (WHERE (chain_run.status = 'running'::text)) AS running,
            count(*) AS total_runs
           FROM public.chain_run
          GROUP BY chain_run.chain_id
        ), last_run AS (
         SELECT DISTINCT ON (chain_run.chain_id) chain_run.id AS last_run_id,
            chain_run.chain_id,
            chain_run.status,
            chain_run.started_at,
            chain_run.finished_at,
            chain_run.error_text
           FROM public.chain_run
          ORDER BY chain_run.chain_id, chain_run.id DESC
        )
 SELECT pc.id,
    pc.name AS chain_name,
    lr.last_run_id,
    COALESCE(lr.status, 'not_started'::text) AS status,
    COALESCE(ra.running, (0)::bigint) AS running,
    COALESCE(ra.error, (0)::bigint) AS error,
    COALESCE(ra.success, (0)::bigint) AS success,
    COALESCE(ra.total_runs, (0)::bigint) AS total_runs,
    pcs.next_run_at,
    lr.started_at AS last_run_at,
    lr.finished_at AS last_finished_at,
    lr.error_text
   FROM (((public.process_chains pc
     LEFT JOIN last_run lr ON ((lr.chain_id = pc.id)))
     LEFT JOIN run_agg ra ON ((ra.chain_id = pc.id)))
     LEFT JOIN public.process_chain_schedules pcs ON ((pcs.chain_id = pc.id)));


ALTER VIEW public.monitor_chains OWNER TO postgres;

--
-- TOC entry 226 (class 1259 OID 16469)
-- Name: monitor_flow_runs; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.monitor_flow_runs AS
 SELECT flow_run.id,
    flow_run.chain_run_id,
    flow_run.chain_id,
    flow_run.flow_id,
    flow_run.status,
    flow_run.started_at,
    flow_run.finished_at,
    flow_run.error_text,
    flow_run.stdout,
    flow_run.stderr
   FROM public.flow_run;


ALTER VIEW public.monitor_flow_runs OWNER TO postgres;

--
-- TOC entry 234 (class 1259 OID 16536)
-- Name: process_chain_history; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.process_chain_history (
    id bigint NOT NULL,
    chain_id integer NOT NULL,
    version integer NOT NULL,
    data jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by integer
);


ALTER TABLE public.process_chain_history OWNER TO postgres;

--
-- TOC entry 233 (class 1259 OID 16535)
-- Name: process_chain_history_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.process_chain_history_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.process_chain_history_id_seq OWNER TO postgres;

--
-- TOC entry 3579 (class 0 OID 0)
-- Dependencies: 233
-- Name: process_chain_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.process_chain_history_id_seq OWNED BY public.process_chain_history.id;


--
-- TOC entry 227 (class 1259 OID 16473)
-- Name: process_chain_schedules_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.process_chain_schedules_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.process_chain_schedules_id_seq OWNER TO postgres;

--
-- TOC entry 3580 (class 0 OID 0)
-- Dependencies: 227
-- Name: process_chain_schedules_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.process_chain_schedules_id_seq OWNED BY public.process_chain_schedules.id;


--
-- TOC entry 228 (class 1259 OID 16474)
-- Name: process_chains_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.process_chains_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.process_chains_id_seq OWNER TO postgres;

--
-- TOC entry 3581 (class 0 OID 0)
-- Dependencies: 228
-- Name: process_chains_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.process_chains_id_seq OWNED BY public.process_chains.id;


--
-- TOC entry 229 (class 1259 OID 16475)
-- Name: requests_object; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.requests_object AS
 SELECT journal_table.request_id,
    journal_table.status,
    sum(journal_table.rows_count) AS sum
   FROM public.journal_table
  WHERE (journal_table.target_connection_id = 1)
  GROUP BY journal_table.request_id, journal_table.status
  ORDER BY journal_table.request_id DESC;


ALTER VIEW public.requests_object OWNER TO postgres;

--
-- TOC entry 238 (class 1259 OID 16607)
-- Name: transfer_packages; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.transfer_packages (
    id bigint NOT NULL,
    package_uuid uuid NOT NULL,
    environment text NOT NULL,
    file_data bytea NOT NULL,
    status text NOT NULL,
    created_by bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    validated_at timestamp with time zone,
    applied_at timestamp with time zone,
    downloaded_at timestamp with time zone,
    error_message text,
    direction character varying(10) NOT NULL,
    CONSTRAINT transfer_packages_status_check CHECK ((status = ANY (ARRAY['ready'::text, 'uploaded'::text, 'validated'::text, 'applied'::text, 'downloaded'::text, 'error'::text]))),
    CONSTRAINT transfer_packages_direction_check CHECK (((direction)::text = ANY ((ARRAY['export'::character varying, 'import'::character varying])::text[])))
);


ALTER TABLE public.transfer_packages OWNER TO postgres;

--
-- TOC entry 237 (class 1259 OID 16606)
-- Name: transfer_packages_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.transfer_packages ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.transfer_packages_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 230 (class 1259 OID 16479)
-- Name: user_settings; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.user_settings (
    user_id bigint NOT NULL,
    display_name text,
    theme_code text DEFAULT 'dark'::text NOT NULL,
    updated_at timestamp without time zone DEFAULT now(),
    locale_code text DEFAULT 'en'::text NOT NULL
);


ALTER TABLE public.user_settings OWNER TO postgres;

--
-- TOC entry 231 (class 1259 OID 16486)
-- Name: workspaces; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.workspaces (
    id integer NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.workspaces OWNER TO postgres;

--
-- TOC entry 232 (class 1259 OID 16492)
-- Name: workspaces_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.workspaces_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.workspaces_id_seq OWNER TO postgres;

--
-- TOC entry 3582 (class 0 OID 0)
-- Dependencies: 232
-- Name: workspaces_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.workspaces_id_seq OWNED BY public.workspaces.id;


--
-- TOC entry 3337 (class 2604 OID 16493)
-- Name: chain_run id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chain_run ALTER COLUMN id SET DEFAULT nextval('public.chain_run_id_seq'::regclass);


--
-- TOC entry 3342 (class 2604 OID 16494)
-- Name: connections id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.connections ALTER COLUMN id SET DEFAULT nextval('public.connections2_id_seq'::regclass);


--
-- TOC entry 3347 (class 2604 OID 16495)
-- Name: flow_run id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.flow_run ALTER COLUMN id SET DEFAULT nextval('public.flow_run_id_seq'::regclass);


--
-- TOC entry 3351 (class 2604 OID 16496)
-- Name: flows id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.flows ALTER COLUMN id SET DEFAULT nextval('public.flows2_id_seq'::regclass);


--
-- TOC entry 3354 (class 2604 OID 16497)
-- Name: journal_table id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.journal_table ALTER COLUMN id SET DEFAULT nextval('public.journal_table_id_seq'::regclass);


--
-- TOC entry 3369 (class 2604 OID 16539)
-- Name: process_chain_history id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.process_chain_history ALTER COLUMN id SET DEFAULT nextval('public.process_chain_history_id_seq'::regclass);


--
-- TOC entry 3359 (class 2604 OID 16498)
-- Name: process_chain_schedules id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.process_chain_schedules ALTER COLUMN id SET DEFAULT nextval('public.process_chain_schedules_id_seq'::regclass);


--
-- TOC entry 3355 (class 2604 OID 16499)
-- Name: process_chains id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.process_chains ALTER COLUMN id SET DEFAULT nextval('public.process_chains_id_seq'::regclass);


--
-- TOC entry 3367 (class 2604 OID 16500)
-- Name: workspaces id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.workspaces ALTER COLUMN id SET DEFAULT nextval('public.workspaces_id_seq'::regclass);


--
-- TOC entry 3403 (class 2606 OID 16562)
-- Name: app_users app_users_identity_uk; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.app_users
    ADD CONSTRAINT app_users_identity_uk UNIQUE (issuer, subject);


--
-- TOC entry 3405 (class 2606 OID 16560)
-- Name: app_users app_users_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.app_users
    ADD CONSTRAINT app_users_pkey PRIMARY KEY (id);


--
-- TOC entry 3374 (class 2606 OID 16502)
-- Name: chain_run chain_run_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chain_run
    ADD CONSTRAINT chain_run_pkey PRIMARY KEY (id);


--
-- TOC entry 3377 (class 2606 OID 16651)
-- Name: connections connections_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.connections
    ADD CONSTRAINT connections_pkey PRIMARY KEY (id);


--
-- TOC entry 3383 (class 2606 OID 16504)
-- Name: journal_table etl_journal_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.journal_table
    ADD CONSTRAINT etl_journal_pkey PRIMARY KEY (id);


--
-- TOC entry 3388 (class 2606 OID 16506)
-- Name: process_chains fchains_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.process_chains
    ADD CONSTRAINT fchains_pkey PRIMARY KEY (id);


--
-- TOC entry 3379 (class 2606 OID 16508)
-- Name: flow_run flow_run_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.flow_run
    ADD CONSTRAINT flow_run_pkey PRIMARY KEY (id);


--
-- TOC entry 3381 (class 2606 OID 16510)
-- Name: flows flows_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.flows
    ADD CONSTRAINT flows_pkey PRIMARY KEY (id);


--
-- TOC entry 3399 (class 2606 OID 16544)
-- Name: process_chain_history process_chain_history_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.process_chain_history
    ADD CONSTRAINT process_chain_history_pkey PRIMARY KEY (id);


--
-- TOC entry 3390 (class 2606 OID 16512)
-- Name: process_chain_schedules process_chain_schedules_chain_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.process_chain_schedules
    ADD CONSTRAINT process_chain_schedules_chain_unique UNIQUE (chain_id);


--
-- TOC entry 3392 (class 2606 OID 16514)
-- Name: process_chain_schedules process_chain_schedules_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.process_chain_schedules
    ADD CONSTRAINT process_chain_schedules_pkey PRIMARY KEY (id);


--
-- TOC entry 3407 (class 2606 OID 16614)
-- Name: transfer_packages transfer_packages_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.transfer_packages
    ADD CONSTRAINT transfer_packages_pkey PRIMARY KEY (id);


--
-- TOC entry 3409 (class 2606 OID 16655)
-- Name: transfer_packages transfer_packages_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.transfer_packages
    ADD CONSTRAINT transfer_packages_unique UNIQUE (package_uuid, direction);


--
-- TOC entry 3401 (class 2606 OID 16546)
-- Name: process_chain_history uq_process_chain_history_chain_version; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.process_chain_history
    ADD CONSTRAINT uq_process_chain_history_chain_version UNIQUE (chain_id, version);


--
-- TOC entry 3394 (class 2606 OID 16564)
-- Name: user_settings user_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_settings
    ADD CONSTRAINT user_settings_pkey PRIMARY KEY (user_id);


--
-- TOC entry 3396 (class 2606 OID 16518)
-- Name: workspaces workspaces_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_pkey PRIMARY KEY (id);


--
-- TOC entry 3384 (class 1259 OID 16519)
-- Name: idx_etl_journal_anti_join; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_etl_journal_anti_join ON public.journal_table USING btree (source, target, request_id, batch_id, status);


--
-- TOC entry 3385 (class 1259 OID 16520)
-- Name: idx_etl_journal_silver_pending; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_etl_journal_silver_pending ON public.journal_table USING btree (target, status, request_id, batch_id);


--
-- TOC entry 3386 (class 1259 OID 16521)
-- Name: idx_journal_table_flow_run_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_journal_table_flow_run_id ON public.journal_table USING btree (flow_run_id);


--
-- TOC entry 3375 (class 1259 OID 16522)
-- Name: ix_chain_run_chain_id_id_desc; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_chain_run_chain_id_id_desc ON public.chain_run USING btree (chain_id, id DESC);


--
-- TOC entry 3397 (class 1259 OID 16552)
-- Name: ix_process_chain_history_chain_id_version; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_process_chain_history_chain_id_version ON public.process_chain_history USING btree (chain_id, version DESC);


--
-- TOC entry 3420 (class 2620 OID 16523)
-- Name: connections update_connections_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_connections_updated_at BEFORE UPDATE ON public.connections FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- TOC entry 3421 (class 2620 OID 16524)
-- Name: flows update_flows_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_flows_updated_at BEFORE UPDATE ON public.flows FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- TOC entry 3422 (class 2620 OID 16525)
-- Name: process_chains update_process_chains_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_process_chains_updated_at BEFORE UPDATE ON public.process_chains FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- TOC entry 3410 (class 2606 OID 16596)
-- Name: chain_run chain_run_started_by_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chain_run
    ADD CONSTRAINT chain_run_started_by_fk FOREIGN KEY (started_by) REFERENCES public.app_users(id);


--
-- TOC entry 3411 (class 2606 OID 16576)
-- Name: connections connections_updated_by_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.connections
    ADD CONSTRAINT connections_updated_by_fk FOREIGN KEY (updated_by) REFERENCES public.app_users(id);


--
-- TOC entry 3412 (class 2606 OID 16526)
-- Name: flow_run flow_run_chain_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.flow_run
    ADD CONSTRAINT flow_run_chain_run_id_fkey FOREIGN KEY (chain_run_id) REFERENCES public.chain_run(id) ON DELETE SET NULL;


--
-- TOC entry 3413 (class 2606 OID 16601)
-- Name: flow_run flow_run_started_by_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.flow_run
    ADD CONSTRAINT flow_run_started_by_fk FOREIGN KEY (started_by) REFERENCES public.app_users(id);


--
-- TOC entry 3414 (class 2606 OID 16581)
-- Name: flows flows_updated_by_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.flows
    ADD CONSTRAINT flows_updated_by_fk FOREIGN KEY (updated_by) REFERENCES public.app_users(id);


--
-- TOC entry 3418 (class 2606 OID 16547)
-- Name: process_chain_history process_chain_history_chain_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.process_chain_history
    ADD CONSTRAINT process_chain_history_chain_id_fkey FOREIGN KEY (chain_id) REFERENCES public.process_chains(id) ON DELETE CASCADE;


--
-- TOC entry 3416 (class 2606 OID 16591)
-- Name: process_chain_schedules process_chain_schedules_updated_by_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.process_chain_schedules
    ADD CONSTRAINT process_chain_schedules_updated_by_fk FOREIGN KEY (updated_by) REFERENCES public.app_users(id);


--
-- TOC entry 3415 (class 2606 OID 16586)
-- Name: process_chains process_chains_updated_by_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.process_chains
    ADD CONSTRAINT process_chains_updated_by_fk FOREIGN KEY (updated_by) REFERENCES public.app_users(id);


--
-- TOC entry 3419 (class 2606 OID 16617)
-- Name: transfer_packages transfer_packages_created_by_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.transfer_packages
    ADD CONSTRAINT transfer_packages_created_by_fk FOREIGN KEY (created_by) REFERENCES public.app_users(id);


--
-- TOC entry 3417 (class 2606 OID 16571)
-- Name: user_settings user_settings_app_user_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_settings
    ADD CONSTRAINT user_settings_app_user_fk FOREIGN KEY (user_id) REFERENCES public.app_users(id);


-- Completed on 2026-09-07 19:08:24 MSK

--
-- PostgreSQL database dump complete
--

\unrestrict ZePjU11UjJtULP13xP0LbAoDAsff5TzlJ4mox23WzVgWpfhllpzNhj4qF7L5J85

