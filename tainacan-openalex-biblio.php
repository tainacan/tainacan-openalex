<?php
/**
 * Plugin Name: Tainacan OpenAlex
 * Description: Busca dados bibliográficos no OpenAlex e preenche metadados no Tainacan.
 * Version: 0.4.0
 * License: GPL v3 or later
 * Requires at least: 6.0
 * Tested up to: 7.0
 * Requires PHP: 7.4
 * Stable tag: 0.4.0
 * Requires Plugins: tainacan
 */

namespace Tainacan {
    // Shim (mantido do seu arquivo)
    if (!function_exists(__NAMESPACE__ . '\\add_settings_field')) {
        function add_settings_field($id, $title, $callback, $page, $section = 'default', $args = []) {
            return \add_settings_field($id, $title, $callback, $page, $section, $args);
        }
    }
    if (!function_exists(__NAMESPACE__ . '\\add_settings_section')) {
        function add_settings_section($id, $title, $callback, $page) {
            return \add_settings_section($id, $title, $callback, $page);
        }
    }
}

namespace {

if (!defined('ABSPATH')) exit;

class Tainacan_OpenAlex_Biblio_MVP {

    const NONCE_ACTION = 'tainacan_openalex_biblio_nonce';

    public function __construct() {
        add_action('plugins_loaded', [$this, 'bootstrap']);
        add_action('admin_init', [$this, 'openalex_settings_init']);

        // ✅ Admin Form Hook (Item form)
        add_action('tainacan-register-admin-hooks', [$this, 'register_admin_hooks']);

        // AJAX OpenAlex
        add_action('wp_ajax_tainacan_openalex_work_search', [$this, 'ajax_work_search']);
        add_action('wp_ajax_tainacan_openalex_work_get',    [$this, 'ajax_work_get']);
        add_action('wp_ajax_tainacan_openalex_get_settings_mapping', [$this, 'ajax_get_settings_mapping']);
    }

    public function bootstrap() {
        add_action('admin_enqueue_scripts', [$this, 'enqueue_assets_wp']);
    }

    public function enqueue_assets_wp($hook) {
        // admin SPA do Tainacan
        /* phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Read-only page identification for asset loading; no form processing. */
        if (!isset($_GET['page']) || $_GET['page'] !== 'tainacan_admin') {
            return;
        }
        $this->enqueue_assets();
    }

    public function enqueue_assets() {
        $url = plugin_dir_url(__FILE__);

        wp_enqueue_style(
            'tainacan-openalex-biblio',
            $url . 'assets/openalex-biblio.css',
            [],
            '0.4.0'
        );

        wp_enqueue_script(
            'tainacan-openalex-biblio',
            $url . 'assets/openalex-biblio.js',
            ['jquery', 'wp-api-fetch'],
            '0.4.2',
            true
        );

        wp_localize_script('tainacan-openalex-biblio', 'tainacanOpenAlexBiblio', [
            'ajaxurl' => admin_url('admin-ajax.php'),
            'nonce'   => wp_create_nonce(self::NONCE_ACTION),
        ]);
    }

    // =========================================
    // ✅ Admin Form Hook: Item form (begin-left)
    // =========================================
    public function register_admin_hooks() {
        if (!function_exists('tainacan_register_admin_hook')) return;
    
        $collection_id = $this->get_opt_int('openalex_references_collection_id');
        if ($collection_id <= 0) return;
    
        tainacan_register_admin_hook(
            'item',
            [$this, 'render_item_hook'],
            'begin-left',
            [
                'collectionId' => (string) $collection_id,
            ]
        );
    }

    public function render_item_hook() {
        ob_start();
        ?>
        <div class="field form-hook-region">
            <h4 style="margin:0 0 .5rem 0;"><?php esc_html_e('OpenAlex (Bibliografia)', 'tainacan-openalex'); ?></h4>
            <p class="help" style="margin:.25rem 0 1rem 0;opacity:.85;">
                <?php esc_html_e('Pesquise e clique em um resultado para preencher os metadados deste item.', 'tainacan-openalex'); ?>
            </p>

            <!-- ✅ root controlado pelo JS -->
            <div id="openalex-biblio-hook-root"></div>
        </div>
        <?php
        return ob_get_clean();
    }

    private function get_collections_select_options_html(): string {
    if (!class_exists('\\Tainacan\\Repositories\\Collections')) {
        return '<option value="">' . esc_html__('Selecione uma coleção', 'tainacan-openalex') . '</option>';
    }

    $options = '<option value="">' . esc_html__('Selecione uma coleção', 'tainacan-openalex') . '</option>';

    try {
        $collections_repo = \Tainacan\Repositories\Collections::get_instance();
        $collections = $collections_repo->fetch([], 'OBJECT');

        if (is_array($collections)) {
            foreach ($collections as $collection) {
                if (!is_object($collection) || !method_exists($collection, 'get_id') || !method_exists($collection, 'get_name')) {
                    continue;
                }

                $options .= sprintf(
                    '<option value="%d">%s</option>',
                    (int) $collection->get_id(),
                    esc_html($collection->get_name())
                );
            }
        }
    } catch (\Throwable $e) {
        return $options;
    }

    return $options;
}


private function get_metadata_select_options_html(array $allowed_metadata_types = []): string {
    if (!class_exists('\\Tainacan\\Repositories\\Metadata')) {
        return '<option value="0">' . esc_html__('Selecione um metadado', 'tainacan-openalex') . '</option>';
    }

    $collection_id = (int) get_option('tainacan_option_openalex_references_collection_id', 0);

    $options = '<option value="0">' . esc_html__('Selecione um metadado', 'tainacan-openalex') . '</option>';

    if ($collection_id <= 0) {
        return $options;
    }

    try {
        $metadata_repo = \Tainacan\Repositories\Metadata::get_instance();
        $metadata_list = $metadata_repo->fetch([
            'collection_id' => $collection_id
        ], 'OBJECT');

        if (is_array($metadata_list)) {
            foreach ($metadata_list as $metadatum) {
                if (
                    !is_object($metadatum) ||
                    !method_exists($metadatum, 'get_id') ||
                    !method_exists($metadatum, 'get_name') ||
                    !method_exists($metadatum, 'get_metadata_type')
                ) {
                    continue;
                }

                $metadata_type = (string) $metadatum->get_metadata_type();

                if (!empty($allowed_metadata_types) && !in_array($metadata_type, $allowed_metadata_types, true)) {
                    continue;
                }

                $options .= sprintf(
                    '<option value="%d">%s</option>',
                    (int) $metadatum->get_id(),
                    esc_html($metadatum->get_name())
                );
            }
        }
    } catch (\Throwable $e) {
        return $options;
    }

    return $options;
}




    public function openalex_settings_init() {
        // Seção nova na Settings Page do Tainacan
        add_settings_section(
            'openalex_biblio_settings_section',
            __('OpenAlex Biblio', 'tainacan-openalex'),
            function () {
                echo '<p class="settings-section-description">';
                esc_html_e('Configure a coleção de referências e o mapeamento dos campos (OpenAlex → Metadados).', 'tainacan-openalex');
                echo '</p>';
            },
            'tainacan_settings'
        );

        if (!class_exists('\\Tainacan\\Settings')) return;
        $settings = \Tainacan\Settings::get_instance();
        if (!method_exists($settings, 'create_tainacan_setting')) return;

        $settings->create_tainacan_setting([
            'id'               => 'openalex_references_collection_id',
            'title'            => __('Coleção de Referências', 'tainacan-openalex'),
            'section'          => 'openalex_biblio_settings_section',
            'type'             => 'integer',
            'input_type'       => 'select',
            'input_inner_html' => $this->get_collections_select_options_html(),
            'description'      => __('Selecione a coleção do Tainacan onde ficam as referências bibliográficas.', 'tainacan-openalex'),
            'default'          => 0,
            'sanitize_callback'=> 'absint'
        ]);

        $settings->create_tainacan_setting([
            'id'          => 'openalex_api_key',
            'title'       => __('OpenAlex API Key (opcional)', 'tainacan-openalex'),
            'section'     => 'openalex_biblio_settings_section',
            'type'        => 'string',
            'input_type'  => 'password',
            'description' => __('Se você tiver API Key, informe aqui. Caso contrário, deixe vazio.', 'tainacan-openalex'),
            'default'     => ''
        ]);

        // Mapeamento (IDs de metadados)
$settings->create_tainacan_setting([
    'id'               => 'openalex_map_title',
    'title'            => __('Mapeamento: Title → Metadado', 'tainacan-openalex'),
    'section'          => 'openalex_biblio_settings_section',
    'type'             => 'integer',
    'input_type'       => 'select',
    'input_inner_html' => $this->get_metadata_select_options_html([
        'Tainacan\\Metadata_Types\\Core_Title',
        'Tainacan\\Metadata_Types\\Text',
    ]),
    'description'      => __('Selecione o metadado da coleção que receberá o TÍTULO.', 'tainacan-openalex'),
    'default'          => 0,
    'sanitize_callback'=> 'absint'
]);

$settings->create_tainacan_setting([
    'id'               => 'openalex_map_authors',
    'title'            => __('Mapeamento: Authors → Metadado', 'tainacan-openalex'),
    'section'          => 'openalex_biblio_settings_section',
    'type'             => 'integer',
    'input_type'       => 'select',
    'input_inner_html' => $this->get_metadata_select_options_html([
        'Tainacan\\Metadata_Types\\Text',
        'Tainacan\\Metadata_Types\\Textarea',
        'Tainacan\\Metadata_Types\\Selectbox',
    ]),
    'description'      => __('Selecione o metadado da coleção que receberá os AUTORES.', 'tainacan-openalex'),
    'default'          => 0,
    'sanitize_callback'=> 'absint'
]);

$settings->create_tainacan_setting([
    'id'               => 'openalex_map_year',
    'title'            => __('Mapeamento: Year → Metadado', 'tainacan-openalex'),
    'section'          => 'openalex_biblio_settings_section',
    'type'             => 'integer',
    'input_type'       => 'select',
    'input_inner_html' => $this->get_metadata_select_options_html([
        'Tainacan\\Metadata_Types\\Text',
        'Tainacan\\Metadata_Types\\Numeric',
    ]),
    'description'      => __('Selecione o metadado da coleção que receberá o ANO.', 'tainacan-openalex'),
    'default'          => 0,
    'sanitize_callback'=> 'absint'
]);

$settings->create_tainacan_setting([
    'id'               => 'openalex_map_doi',
    'title'            => __('Mapeamento: DOI → Metadado', 'tainacan-openalex'),
    'section'          => 'openalex_biblio_settings_section',
    'type'             => 'integer',
    'input_type'       => 'select',
    'input_inner_html' => $this->get_metadata_select_options_html([
        'Tainacan\\Metadata_Types\\Text',
        'Tainacan\\Metadata_Types\\URL',
    ]),
    'description'      => __('Selecione o metadado da coleção que receberá o DOI.', 'tainacan-openalex'),
    'default'          => 0,
    'sanitize_callback'=> 'absint'
]);

$settings->create_tainacan_setting([
    'id'               => 'openalex_map_venue',
    'title'            => __('Mapeamento: Venue → Metadado', 'tainacan-openalex'),
    'section'          => 'openalex_biblio_settings_section',
    'type'             => 'integer',
    'input_type'       => 'select',
    'input_inner_html' => $this->get_metadata_select_options_html([
        'Tainacan\\Metadata_Types\\Text',
        'Tainacan\\Metadata_Types\\Textarea',
        'Tainacan\\Metadata_Types\\Selectbox',
    ]),
    'description'      => __('Selecione o metadado da coleção que receberá o PERIÓDICO/VEÍCULO.', 'tainacan-openalex'),
    'default'          => 0,
    'sanitize_callback'=> 'absint'
]);

$settings->create_tainacan_setting([
    'id'               => 'openalex_map_url',
    'title'            => __('Mapeamento: URL → Metadado', 'tainacan-openalex'),
    'section'          => 'openalex_biblio_settings_section',
    'type'             => 'integer',
    'input_type'       => 'select',
    'input_inner_html' => $this->get_metadata_select_options_html([
        'Tainacan\\Metadata_Types\\Text',
        'Tainacan\\Metadata_Types\\URL',
    ]),
    'description'      => __('Selecione o metadado da coleção que receberá a URL.', 'tainacan-openalex'),
    'default'          => 0,
    'sanitize_callback'=> 'absint'
]);

$settings->create_tainacan_setting([
    'id'               => 'openalex_map_abnt',
    'title'            => __('Mapeamento: Referência (ABNT) → Metadado', 'tainacan-openalex'),
    'section'          => 'openalex_biblio_settings_section',
    'type'             => 'integer',
    'input_type'       => 'select',
    'input_inner_html' => $this->get_metadata_select_options_html([
        'Tainacan\\Metadata_Types\\Text',
        'Tainacan\\Metadata_Types\\Textarea',
        'Tainacan\\Metadata_Types\\URL',
    ]),
    'description'      => __('Selecione o metadado da coleção que receberá a referência formatada.', 'tainacan-openalex'),
    'default'          => 0,
    'sanitize_callback'=> 'absint'
]);
    }

    public function ajax_get_settings_mapping() {
        check_ajax_referer(self::NONCE_ACTION, 'nonce');
        if (!current_user_can('edit_posts')) {
            wp_send_json_error(['message' => 'Sem permissão.'], 403);
        }

        $mapping = [
            'title'   => $this->get_valid_mapping_metadatum_id('openalex_map_title', [
                'Tainacan\\Metadata_Types\\Core_Title',
                'Tainacan\\Metadata_Types\\Text',
            ]),
            'authors' => $this->get_valid_mapping_metadatum_id('openalex_map_authors', [
                'Tainacan\\Metadata_Types\\Text',
                'Tainacan\\Metadata_Types\\Textarea',
                'Tainacan\\Metadata_Types\\Selectbox',
            ]),
            'year'    => $this->get_valid_mapping_metadatum_id('openalex_map_year', [
                'Tainacan\\Metadata_Types\\Text',
                'Tainacan\\Metadata_Types\\Numeric',
            ]),
            'doi'     => $this->get_valid_mapping_metadatum_id('openalex_map_doi', [
                'Tainacan\\Metadata_Types\\Text',
                'Tainacan\\Metadata_Types\\URL',
            ]),
            'venue'   => $this->get_valid_mapping_metadatum_id('openalex_map_venue', [
                'Tainacan\\Metadata_Types\\Text',
                'Tainacan\\Metadata_Types\\Textarea',
                'Tainacan\\Metadata_Types\\Selectbox',
            ]),
            'url'     => $this->get_valid_mapping_metadatum_id('openalex_map_url', [
                'Tainacan\\Metadata_Types\\Text',
                'Tainacan\\Metadata_Types\\URL',
            ]),
            'abnt'    => $this->get_valid_mapping_metadatum_id('openalex_map_abnt', [
                'Tainacan\\Metadata_Types\\Text',
                'Tainacan\\Metadata_Types\\Textarea',
                'Tainacan\\Metadata_Types\\URL',
            ]),
        ];
    
        wp_send_json_success(['mapping' => $mapping]);
    }

    private function get_valid_mapping_metadatum_id(string $option_id, array $allowed_metadata_types): int {
        $metadatum_id = (int) get_option('tainacan_option_' . $option_id, 0);
    
        if ($metadatum_id <= 0) {
            return 0;
        }
    
        $metadata_type = $this->get_metadatum_type_class($metadatum_id);
    
        if ($metadata_type === '') {
            return 0;
        }
    
        return in_array($metadata_type, $allowed_metadata_types, true)
            ? $metadatum_id
            : 0;
    }
    
    private function get_metadatum_type_class(int $metadatum_id): string {
        if ($metadatum_id <= 0) {
            return '';
        }
    
        if (!class_exists('\\Tainacan\\Entities\\Metadatum')) {
            return '';
        }
    
        try {
            $metadatum = new \Tainacan\Entities\Metadatum($metadatum_id);
        } catch (\Throwable $e) {
            return '';
        }
    
        if (!method_exists($metadatum, 'get_metadata_type')) {
            return '';
        }
    
        return (string) $metadatum->get_metadata_type();
    }

    public function ajax_work_search() {
        check_ajax_referer(self::NONCE_ACTION, 'nonce');
        if (!current_user_can('edit_posts')) {
            wp_send_json_error(['message' => 'Sem permissão.'], 403);
        }

        $q = isset($_POST['q']) ? sanitize_text_field(wp_unslash($_POST['q'])) : '';
        if (!$q) {
            wp_send_json_error(['message' => 'Consulta vazia.'], 400);
        }

        $search_type = isset($_POST['search_type']) ? sanitize_key(wp_unslash($_POST['search_type'])) : 'free';
        $allowed_types = ['author', 'title', 'free', 'doi', 'issn'];

        if (!in_array($search_type, $allowed_types, true)) {
            $search_type = 'free';
        }

        $api_key = $this->get_opt_str('openalex_api_key');

        switch ($search_type) {
            case 'doi':
                $result = $this->search_work_by_doi($q, $api_key);
                break;
            case 'author':
                $result = $this->search_works_by_author($q, $api_key);
                break;
            case 'issn':
                $result = $this->search_works_by_issn($q, $api_key);
                break;
            case 'title':
            case 'free':
            default:
                $result = $this->search_works_by_text($q, $api_key, $search_type);
                break;
        }

        if (!$result['success']) {
            wp_send_json_error([
                'message' => $result['message'],
                'debug'   => $result['debug'] ?? [],
            ], $result['status'] ?? 502);
        }

        wp_send_json_success([
            'results'     => $result['results'],
            'search_type' => $search_type,
            'resolved'    => $result['resolved'] ?? null,
        ]);
    }

    public function ajax_work_get() {
        check_ajax_referer(self::NONCE_ACTION, 'nonce');
        if (!current_user_can('edit_posts')) {
            wp_send_json_error(['message' => 'Sem permissão.'], 403);
        }

        $id = isset($_POST['id']) ? esc_url_raw(wp_unslash($_POST['id'])) : '';
        if (!$id) wp_send_json_error(['message' => 'ID vazio.'], 400);

        $api_key = $this->get_opt_str('openalex_api_key');

        $url = $id;
        if (strpos($url, 'api.openalex.org/works/') === false) {
            $url = 'https://api.openalex.org/works/' . ltrim($id, '/');
        }

        $args = [
            'select' => 'id,title,publication_year,doi,authorships,primary_location',
        ];
        if ($api_key !== '') $args['api_key'] = $api_key;

        $url = add_query_arg($args, $url);

        $resp = wp_remote_get($url, [
            'timeout' => 15,
            'headers' => ['Accept' => 'application/json'],
        ]);

        if (is_wp_error($resp)) wp_send_json_error(['message' => $resp->get_error_message()], 500);

        $code = wp_remote_retrieve_response_code($resp);
        $body = wp_remote_retrieve_body($resp);

        if ($code < 200 || $code >= 300) {
            wp_send_json_error(['message' => 'Erro no OpenAlex', 'status' => $code, 'body' => $body], 502);
        }

        $w = json_decode($body, true);

        $authors = [];
        foreach (($w['authorships'] ?? []) as $a) {
            $name = $a['author']['display_name'] ?? null;
            if ($name) $authors[] = $name;
        }

        $venue = $w['primary_location']['source']['display_name'] ?? null;

        $out = [
            'id'           => $w['id'] ?? null,
            'title'        => $w['title'] ?? null,
            'year'         => $w['publication_year'] ?? null,
            'doi'          => $w['doi'] ?? null,
            'venue'        => $venue,
            'authors'      => implode('; ', $authors),
            'authors_list' => array_values($authors),
            'url'          => $w['id'] ?? null,
        ];

        $out['abnt'] = $this->format_abnt_basic($out);

        wp_send_json_success(['work' => $out]);
    }

    private function search_works_by_text(string $query, string $api_key, string $mode = 'free'): array {
        $args = [
            'search'   => $query,
            'per-page' => 10,
            'select'   => 'id,title,publication_year,doi',
        ];

        if ($api_key !== '') {
            $args['api_key'] = $api_key;
        }

        $url = add_query_arg($args, 'https://api.openalex.org/works');
        $res = $this->perform_openalex_request($url);

        if (!$res['success']) {
            return $res;
        }

        return [
            'success'  => true,
            'results'  => $this->normalize_work_list($res['json']['results'] ?? []),
            'resolved' => [
                'type'    => $mode,
                'message' => $mode === 'title'
                    ? 'Busca por título executada.'
                    : 'Busca livre executada.',
            ],
        ];
    }

    private function search_work_by_doi(string $doi, string $api_key): array {
        $doi = trim($doi);
        $doi = preg_replace('#^https?://(dx\.)?doi\.org/#i', '', $doi);
        $doi = preg_replace('#^doi:#i', '', $doi);

        if ($doi === '') {
            return [
                'success' => false,
                'status'  => 400,
                'message' => 'DOI inválido.',
            ];
        }

        $url = 'https://api.openalex.org/works/' . rawurlencode('doi:' . $doi);
        $args = [
            'select' => 'id,title,publication_year,doi',
        ];
        if ($api_key !== '') {
            $args['api_key'] = $api_key;
        }
        $url = add_query_arg($args, $url);

        $res = $this->perform_openalex_request($url);
        if (!$res['success']) {
            return $res;
        }

        return [
            'success'  => true,
            'results'  => [$this->normalize_work_item($res['json'])],
            'resolved' => [
                'type'    => 'doi',
                'message' => 'DOI resolvido com sucesso.',
            ],
        ];
    }

    private function search_works_by_author(string $author_name, string $api_key): array {
        $author_args = [
            'search'   => $author_name,
            'per-page' => 5,
            'select'   => 'id,display_name,works_count,cited_by_count',
        ];
        if ($api_key !== '') {
            $author_args['api_key'] = $api_key;
        }

        $author_url = add_query_arg($author_args, 'https://api.openalex.org/authors');
        $author_res = $this->perform_openalex_request($author_url);

        if (!$author_res['success']) {
            return $author_res;
        }

        $authors = $author_res['json']['results'] ?? [];
        if (empty($authors)) {
            return [
                'success' => false,
                'status'  => 404,
                'message' => 'Nenhum autor encontrado.',
            ];
        }

        $selected_author = $authors[0];
        $author_id = $this->extract_short_openalex_id($selected_author['id'] ?? '');

        if ($author_id === '') {
            return [
                'success' => false,
                'status'  => 502,
                'message' => 'Não foi possível resolver o ID do autor.',
            ];
        }

        $works_args = [
            'filter'   => 'authorships.author.id:' . $author_id,
            'per-page' => 10,
            'sort'     => 'publication_year:desc',
            'select'   => 'id,title,publication_year,doi',
        ];
        if ($api_key !== '') {
            $works_args['api_key'] = $api_key;
        }

        $works_url = add_query_arg($works_args, 'https://api.openalex.org/works');
        $works_res = $this->perform_openalex_request($works_url);

        if (!$works_res['success']) {
            return $works_res;
        }

        return [
            'success'  => true,
            'results'  => $this->normalize_work_list($works_res['json']['results'] ?? []),
            'resolved' => [
                'type'          => 'author',
                'id'            => $author_id,
                'display_name'  => $selected_author['display_name'] ?? $author_name,
                'works_count'   => $selected_author['works_count'] ?? null,
                'cited_by_count'=> $selected_author['cited_by_count'] ?? null,
                'message'       => 'Autor resolvido para o primeiro resultado retornado pelo OpenAlex.',
            ],
        ];
    }

    private function search_works_by_issn(string $issn, string $api_key): array {
        $issn = strtoupper(trim($issn));
        $issn = preg_replace('/[^0-9X\-]/', '', $issn);

        if ($issn === '') {
            return [
                'success' => false,
                'status'  => 400,
                'message' => 'ISSN inválido.',
            ];
        }

        $source_url = 'https://api.openalex.org/sources/' . rawurlencode('issn:' . $issn);
        $source_args = [
            'select' => 'id,display_name,issn,issn_l,works_count',
        ];
        if ($api_key !== '') {
            $source_args['api_key'] = $api_key;
        }
        $source_url = add_query_arg($source_args, $source_url);

        $source_res = $this->perform_openalex_request($source_url);
        if (!$source_res['success']) {
            return $source_res;
        }

        $source = $source_res['json'];
        $source_id = $this->extract_short_openalex_id($source['id'] ?? '');

        if ($source_id === '') {
            return [
                'success' => false,
                'status'  => 502,
                'message' => 'Não foi possível resolver a source a partir do ISSN.',
            ];
        }

        $works_args = [
            'filter'   => 'primary_location.source.id:' . $source_id,
            'per-page' => 10,
            'sort'     => 'publication_year:desc',
            'select'   => 'id,title,publication_year,doi',
        ];
        if ($api_key !== '') {
            $works_args['api_key'] = $api_key;
        }

        $works_url = add_query_arg($works_args, 'https://api.openalex.org/works');
        $works_res = $this->perform_openalex_request($works_url);

        if (!$works_res['success']) {
            return $works_res;
        }

        return [
            'success'  => true,
            'results'  => $this->normalize_work_list($works_res['json']['results'] ?? []),
            'resolved' => [
                'type'         => 'issn',
                'id'           => $source_id,
                'display_name' => $source['display_name'] ?? '',
                'issn_l'       => $source['issn_l'] ?? '',
                'works_count'  => $source['works_count'] ?? null,
                'message'      => 'ISSN resolvido para a source principal retornada pelo OpenAlex.',
            ],
        ];
    }

    private function perform_openalex_request(string $url): array {
        $resp = wp_remote_get($url, [
            'timeout' => 15,
            'headers' => ['Accept' => 'application/json'],
        ]);

        if (is_wp_error($resp)) {
            return [
                'success' => false,
                'status'  => 500,
                'message' => $resp->get_error_message(),
                'debug'   => ['url' => $url],
            ];
        }

        $code = wp_remote_retrieve_response_code($resp);
        $body = wp_remote_retrieve_body($resp);

        if ($code < 200 || $code >= 300) {
            return [
                'success' => false,
                'status'  => 502,
                'message' => 'Erro no OpenAlex',
                'debug'   => [
                    'url'    => $url,
                    'status' => $code,
                    'body'   => $body,
                ],
            ];
        }

        $json = json_decode($body, true);
        if (!is_array($json)) {
            return [
                'success' => false,
                'status'  => 502,
                'message' => 'Resposta JSON inválida do OpenAlex.',
                'debug'   => ['url' => $url],
            ];
        }

        return [
            'success' => true,
            'status'  => $code,
            'json'    => $json,
        ];
    }

    private function normalize_work_list(array $results): array {
        $out = [];
        foreach ($results as $w) {
            $out[] = $this->normalize_work_item($w);
        }
        return $out;
    }

    private function normalize_work_item(array $w): array {
        return [
            'id'    => $w['id'] ?? null,
            'title' => $w['title'] ?? ($w['display_name'] ?? null),
            'year'  => $w['publication_year'] ?? null,
            'doi'   => $w['doi'] ?? null,
        ];
    }

    private function extract_short_openalex_id(string $id): string {
        $id = trim($id);
        if ($id === '') return '';

        $id = preg_replace('#^https?://openalex\.org/#i', '', $id);
        return strtoupper($id);
    }

    private function format_abnt_basic(array $work): string {
        $authorsRaw = trim((string)($work['authors'] ?? ''));
        $title      = trim((string)($work['title'] ?? ''));
        $venue      = trim((string)($work['venue'] ?? ''));
        $year       = trim((string)($work['year'] ?? ''));
        $doi        = trim((string)($work['doi'] ?? ''));
        $url        = trim((string)($work['url'] ?? ''));

        $authorsFmt = '';
        if ($authorsRaw !== '') {
            $authors = array_values(array_filter(array_map('trim', explode(';', $authorsRaw))));
            $max = 3;
            if (count($authors) > $max) {
                $authors = array_slice($authors, 0, $max);
                $authorsFmt = implode('; ', $authors) . '; et al.';
            } else {
                $authorsFmt = implode('; ', $authors);
            }
            $authorsFmt = rtrim($authorsFmt, '.') . '.';
        }

        $doiPart = $doi !== '' ? ('DOI: ' . rtrim($doi, '.') . '.') : '';
        $urlPart = $url !== '' ? ('Disponível em: ' . rtrim($url, '.') . '. Acesso em: ' . date_i18n('d M. Y') . '.') : '';

        $parts = [];
        if ($authorsFmt) $parts[] = $authorsFmt;
        if ($title)      $parts[] = rtrim($title, '.') . '.';
        if ($venue)      $parts[] = rtrim($venue, '.') . '.';
        if ($year)       $parts[] = rtrim($year, '.') . '.';
        if ($doiPart)    $parts[] = $doiPart;
        if ($urlPart)    $parts[] = $urlPart;

        return trim(preg_replace('/\s+/', ' ', implode(' ', $parts)));
    }

    private function get_opt_str($id) {
        return (string) get_option('tainacan_option_' . $id, '');
    }

    private function get_opt_int($id) {
        return (int) get_option('tainacan_option_' . $id, 0);
    }

}

new Tainacan_OpenAlex_Biblio_MVP();

} // namespace
