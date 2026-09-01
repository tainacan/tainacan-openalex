<?php
/**
 * Plugin Name: Tainacan OpenAlex
 * Description: Busca dados bibliográficos no OpenAlex e preenche metadados no Tainacan.
 * Version: 0.4.3
 * License: GPL v3 or later
 * Requires at least: 6.0
 * Tested up to: 7.0
 * Requires PHP: 7.4
 * Stable tag: 0.4.3
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

class Tainacan_OpenAlex_Biblio {

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
        add_action('wp_ajax_tainacan_openalex_resolve_metadata_values', [$this, 'ajax_resolve_metadata_values']);
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
            '0.4.3'
        );

        $js_path = plugin_dir_path(__FILE__) . 'assets/openalex-biblio.js';

        wp_enqueue_script(
            'tainacan-openalex-biblio',
            $url . 'assets/openalex-biblio.js',
            ['jquery', 'wp-api-fetch'],
            file_exists($js_path) ? filemtime($js_path) : '0.4.3',
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
        <h4><?php esc_html_e('OpenAlex', 'tainacan-openalex'); ?></h4>
        <div class="field openalex-biblio-hook">
            <label class="label"><?php esc_html_e('Preencher bibliografia', 'tainacan-openalex'); ?></label>
            <p class="help">
                <?php esc_html_e('Pesquise e clique em um resultado para preencher os metadados do item.', 'tainacan-openalex'); ?>
            </p>
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

// issue 11
    private function get_openalex_mapping_options(): array {
        return [
            'openalex_map_title'   => __('Título', 'tainacan-openalex'),
            'openalex_map_authors' => __('Autores', 'tainacan-openalex'),
            'openalex_map_year'    => __('Ano', 'tainacan-openalex'),
            'openalex_map_doi'     => __('DOI', 'tainacan-openalex'),
            'openalex_map_venue'   => __('Periódico/Veículo', 'tainacan-openalex'),
            'openalex_map_url'     => __('URL', 'tainacan-openalex'),
            'openalex_map_abnt'    => __('Referência ABNT', 'tainacan-openalex'),
        ];
    }

    private function get_submitted_openalex_mapping_values(): array {
        $values = [];

        foreach (array_keys($this->get_openalex_mapping_options()) as $option_id) {
            $wp_option_name = 'tainacan_option_' . $option_id;

            if (isset($_POST[$wp_option_name])) {
                $values[$option_id] = absint(wp_unslash($_POST[$wp_option_name]));
            } else {
                $values[$option_id] = absint(get_option($wp_option_name, 0));
            }
        }

        return $values;
    }

    private function get_tainacan_metadatum_name_by_id(int $metadatum_id): string {
        if ($metadatum_id <= 0) {
            return __('metadado não informado', 'tainacan-openalex');
        }

        if (!class_exists('\\Tainacan\\Repositories\\Metadata')) {
            return sprintf(__('ID %d', 'tainacan-openalex'), $metadatum_id);
        }

        $collection_id = absint(get_option('tainacan_option_openalex_references_collection_id', 0));

        if ($collection_id <= 0) {
            return sprintf(__('ID %d', 'tainacan-openalex'), $metadatum_id);
        }

        try {
            $metadata_repo = \Tainacan\Repositories\Metadata::get_instance();

            $metadata_list = $metadata_repo->fetch([
                'collection_id' => $collection_id,
            ], 'OBJECT');

            if (is_array($metadata_list)) {
                foreach ($metadata_list as $metadatum) {
                    if (
                        is_object($metadatum) &&
                        method_exists($metadatum, 'get_id') &&
                        method_exists($metadatum, 'get_name') &&
                        absint($metadatum->get_id()) === $metadatum_id
                    ) {
                        return (string) $metadatum->get_name();
                    }
                }
            }
        } catch (\Throwable $e) {
            return sprintf(__('ID %d', 'tainacan-openalex'), $metadatum_id);
        }

        return sprintf(__('ID %d', 'tainacan-openalex'), $metadatum_id);
    }

    private function sanitize_openalex_mapping_value($raw_value, string $current_option_id): int {
        static $reported_duplicate_values = [];

        $value = absint($raw_value);

        if ($value <= 0) {
            return 0;
        }

        $submitted_values = $this->get_submitted_openalex_mapping_values();
        $submitted_values[$current_option_id] = $value;

        $duplicated_option_ids = [];

        foreach ($submitted_values as $option_id => $option_value) {
            if ($option_value > 0 && $option_value === $value) {
                $duplicated_option_ids[] = $option_id;
            }
        }

        if (count($duplicated_option_ids) <= 1) {
            return $value;
        }

        if (!isset($reported_duplicate_values[$value])) {
            $mapping_options = $this->get_openalex_mapping_options();

            $duplicated_labels = [];

            foreach ($duplicated_option_ids as $option_id) {
                $duplicated_labels[] = $mapping_options[$option_id] ?? $option_id;
            }

            $metadatum_name = $this->get_tainacan_metadatum_name_by_id($value);

            add_settings_error(
                'tainacan_settings',
                'openalex_duplicate_mapping_' . $value,
                sprintf(
                    __('O metadado “%1$s” já está sendo usado nos campos %2$s. Cada metadado do Tainacan só pode ser associado a um campo da OpenAlex. Escolha outro metadado para continuar.', 'tainacan-openalex'),
                    $metadatum_name,
                    implode(', ', $duplicated_labels)
                ),
                'error'
            );

            $reported_duplicate_values[$value] = true;
        }

        return absint(get_option('tainacan_option_' . $current_option_id, 0));
    }

    public function sanitize_openalex_map_title($value): int {
        return $this->sanitize_openalex_mapping_value($value, 'openalex_map_title');
    }

    public function sanitize_openalex_map_authors($value): int {
        return $this->sanitize_openalex_mapping_value($value, 'openalex_map_authors');
    }

    public function sanitize_openalex_map_year($value): int {
        return $this->sanitize_openalex_mapping_value($value, 'openalex_map_year');
    }

    public function sanitize_openalex_map_doi($value): int {
        return $this->sanitize_openalex_mapping_value($value, 'openalex_map_doi');
    }

    public function sanitize_openalex_map_venue($value): int {
        return $this->sanitize_openalex_mapping_value($value, 'openalex_map_venue');
    }

    public function sanitize_openalex_map_url($value): int {
        return $this->sanitize_openalex_mapping_value($value, 'openalex_map_url');
    }

    public function sanitize_openalex_map_abnt($value): int {
        return $this->sanitize_openalex_mapping_value($value, 'openalex_map_abnt');
    }
// fim issue 11

    public function openalex_settings_init() {
        // Seção nova na Settings Page do Tainacan
        add_settings_section(
            'openalex_biblio_settings_section',
            __('OpenAlex Biblio', 'tainacan-openalex'),
            function () {
                echo '<p class="help">';
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
    'title'            => __('Mapeamento: Título → Metadado', 'tainacan-openalex'),
    'section'          => 'openalex_biblio_settings_section',
    'type'             => 'integer',
    'input_type'       => 'select',
    'input_inner_html' => $this->get_metadata_select_options_html([
        'Tainacan\\Metadata_Types\\Core_Title',
        'Tainacan\\Metadata_Types\\Text',
    ]),
    'description'      => __('Selecione o metadado da coleção que receberá o TÍTULO.', 'tainacan-openalex'),
    'default'          => 0,
    //issue 11
    'sanitize_callback'=> [$this, 'sanitize_openalex_map_title']
    //fim issue 11
]);

$settings->create_tainacan_setting([
    'id'               => 'openalex_map_authors',
    'title'            => __('Mapeamento: Autores → Metadado', 'tainacan-openalex'),
    'section'          => 'openalex_biblio_settings_section',
    'type'             => 'integer',
    'input_type'       => 'select',
    'input_inner_html' => $this->get_metadata_select_options_html([
        'Tainacan\\Metadata_Types\\Text',
        'Tainacan\\Metadata_Types\\Textarea',
        'Tainacan\\Metadata_Types\\Selectbox',
        'Tainacan\\Metadata_Types\\Taxonomy',
    ]),
    'description'      => __('Selecione o metadado da coleção que receberá os AUTORES.', 'tainacan-openalex'),
    'default'          => 0,
    //issue 11
    'sanitize_callback'=> [$this, 'sanitize_openalex_map_authors']
    //fim issue 11
]);

$settings->create_tainacan_setting([
    'id'               => 'openalex_map_year',
    'title'            => __('Mapeamento: Ano → Metadado', 'tainacan-openalex'),
    'section'          => 'openalex_biblio_settings_section',
    'type'             => 'integer',
    'input_type'       => 'select',
    'input_inner_html' => $this->get_metadata_select_options_html([
        'Tainacan\\Metadata_Types\\Text',
        'Tainacan\\Metadata_Types\\Numeric',
        'Tainacan\\Metadata_Types\\Taxonomy',
    ]),
    'description'      => __('Selecione o metadado da coleção que receberá o ANO.', 'tainacan-openalex'),
    'default'          => 0,
    //issue 11
    'sanitize_callback'=> [$this, 'sanitize_openalex_map_year']
    //fim issue 11
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
    // issue 11
    'sanitize_callback'=> [$this, 'sanitize_openalex_map_doi']
    // fim issue 11
]);

$settings->create_tainacan_setting([
    'id'               => 'openalex_map_venue',
    'title'            => __('Mapeamento: Periódico/Veículo → Metadado', 'tainacan-openalex'),
    'section'          => 'openalex_biblio_settings_section',
    'type'             => 'integer',
    'input_type'       => 'select',
    'input_inner_html' => $this->get_metadata_select_options_html([
        'Tainacan\\Metadata_Types\\Text',
        'Tainacan\\Metadata_Types\\Textarea',
        'Tainacan\\Metadata_Types\\Selectbox',
        'Tainacan\\Metadata_Types\\Taxonomy',
    ]),
    'description'      => __('Selecione o metadado da coleção que receberá o PERIÓDICO/VEÍCULO.', 'tainacan-openalex'),
    'default'          => 0,
    // issue 11
    'sanitize_callback'=> [$this, 'sanitize_openalex_map_venue']
    //fim issue 11
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
    // issue 11
    'sanitize_callback'=> [$this, 'sanitize_openalex_map_url']
    // fim issue 11
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
    // issue 11
    'sanitize_callback'=> [$this, 'sanitize_openalex_map_abnt']
    // fim issue 11
]);
    }

    public function ajax_get_settings_mapping() {
        check_ajax_referer(self::NONCE_ACTION, 'nonce');
        $this->ensure_openalex_collection_edit_permission();

        $mapping = [
            'title'   => $this->get_valid_mapping_metadatum_id('openalex_map_title', [
                'Tainacan\\Metadata_Types\\Core_Title',
                'Tainacan\\Metadata_Types\\Text',
            ]),
            'authors' => $this->get_valid_mapping_metadatum_id('openalex_map_authors', [
                'Tainacan\\Metadata_Types\\Text',
                'Tainacan\\Metadata_Types\\Textarea',
                'Tainacan\\Metadata_Types\\Selectbox',
                'Tainacan\\Metadata_Types\\Taxonomy',
            ]),
            'year'    => $this->get_valid_mapping_metadatum_id('openalex_map_year', [
                'Tainacan\\Metadata_Types\\Text',
                'Tainacan\\Metadata_Types\\Numeric',
                'Tainacan\\Metadata_Types\\Taxonomy',
            ]),
            'doi'     => $this->get_valid_mapping_metadatum_id('openalex_map_doi', [
                'Tainacan\\Metadata_Types\\Text',
                'Tainacan\\Metadata_Types\\URL',
            ]),
            'venue'   => $this->get_valid_mapping_metadatum_id('openalex_map_venue', [
                'Tainacan\\Metadata_Types\\Text',
                'Tainacan\\Metadata_Types\\Textarea',
                'Tainacan\\Metadata_Types\\Selectbox',
                'Tainacan\\Metadata_Types\\Taxonomy',
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

    /**
     * Resolve valores recebidos da OpenAlex antes de persistir o metadado.
     *
     * Para metadados comuns, apenas devolve os valores normalizados.
     * Para Taxonomia, devolve IDs de termos existentes ou criados.
     */
    public function ajax_resolve_metadata_values() {
        check_ajax_referer(self::NONCE_ACTION, 'nonce');

        $item_id = isset($_POST['item_id'])
            ? absint(wp_unslash($_POST['item_id']))
            : 0;

        $metadatum_id = isset($_POST['metadatum_id'])
            ? absint(wp_unslash($_POST['metadatum_id']))
            : 0;

        $raw_values = isset($_POST['values'])
            ? wp_unslash($_POST['values'])
            : [];

        if ($item_id <= 0) {
            wp_send_json_error([
                'code'    => 'invalid_item_id',
                'message' => __('O item atual não foi identificado.', 'tainacan-openalex'),
            ], 400);
        }

        if ($metadatum_id <= 0) {
            wp_send_json_error([
                'code'    => 'invalid_metadatum_id',
                'message' => __('O ID do metadado é inválido.', 'tainacan-openalex'),
            ], 400);
        }

        $values = $this->normalize_openalex_metadata_values($raw_values);

        if (empty($values)) {
            wp_send_json_error([
                'code'    => 'empty_values',
                'message' => __('Nenhum valor válido foi recebido.', 'tainacan-openalex'),
            ], 400);
        }

        if (!$this->is_configured_openalex_metadatum($metadatum_id)) {
            wp_send_json_error([
                'code'    => 'metadatum_not_mapped',
                'message' => __('O metadado informado não está configurado no mapeamento da OpenAlex.', 'tainacan-openalex'),
            ], 400);
        }

        if (
            !class_exists('\\Tainacan\\Repositories\\Items') ||
            !class_exists('\\Tainacan\\Repositories\\Metadata')
        ) {
            wp_send_json_error([
                'code'    => 'tainacan_unavailable',
                'message' => __('Os repositórios do Tainacan não estão disponíveis.', 'tainacan-openalex'),
            ], 500);
        }

        try {
            $items_repository = \Tainacan\Repositories\Items::get_instance();
            $metadata_repository = \Tainacan\Repositories\Metadata::get_instance();

            $item = $items_repository->fetch($item_id);
            $metadatum = $metadata_repository->fetch($metadatum_id);
        } catch (\Throwable $e) {
            $this->debug_openalex_resolution_error('Falha ao carregar item ou metadado.', $e);

            wp_send_json_error([
                'code'    => 'tainacan_repository_error',
                'message' => __('Não foi possível carregar o item ou o metadado.', 'tainacan-openalex'),
            ], 500);
        }

        if (!$item instanceof \Tainacan\Entities\Item) {
            wp_send_json_error([
                'code'    => 'item_not_found',
                'message' => __('O item informado não existe.', 'tainacan-openalex'),
            ], 404);
        }

        if (!$item->can_edit()) {
            wp_send_json_error([
                'code'    => 'item_edit_forbidden',
                'message' => __('Você não possui permissão para editar este item.', 'tainacan-openalex'),
            ], 403);
        }

        if (!$metadatum instanceof \Tainacan\Entities\Metadatum) {
            wp_send_json_error([
                'code'    => 'metadatum_not_found',
                'message' => __('O metadado informado não existe.', 'tainacan-openalex'),
            ], 404);
        }

        if (!$metadatum->can_read()) {
            wp_send_json_error([
                'code'    => 'metadatum_read_forbidden',
                'message' => __('Você não possui permissão para utilizar este metadado.', 'tainacan-openalex'),
            ], 403);
        }

        $metadata_type = (string) $metadatum->get_metadata_type();

        if ($metadata_type !== 'Tainacan\\Metadata_Types\\Taxonomy') {
            wp_send_json_success([
                'success'       => true,
                'is_taxonomy'   => false,
                'metadatum_id'  => $metadatum_id,
                'is_multiple'   => $metadatum->is_multiple(),
                'values'        => $values,
                'warnings'      => [],
            ]);
        }

        if (
            !class_exists('\\Tainacan\\Repositories\\Taxonomies') ||
            !class_exists('\\Tainacan\\Repositories\\Terms') ||
            !class_exists('\\Tainacan\\Entities\\Term')
        ) {
            wp_send_json_error([
                'code'    => 'taxonomy_support_unavailable',
                'message' => __('O suporte a taxonomias do Tainacan não está disponível.', 'tainacan-openalex'),
            ], 500);
        }

        $options = $metadatum->get_metadata_type_options();

        if (!is_array($options)) {
            wp_send_json_error([
                'code'    => 'invalid_taxonomy_options',
                'message' => __('As opções do metadado de Taxonomia estão em formato inesperado.', 'tainacan-openalex'),
            ], 500);
        }

        $taxonomy_id = isset($options['taxonomy_id'])
            ? absint($options['taxonomy_id'])
            : 0;

        if ($taxonomy_id <= 0) {
            wp_send_json_error([
                'code'    => 'taxonomy_id_missing',
                'message' => __('O metadado de Taxonomia não possui uma taxonomia associada.', 'tainacan-openalex'),
            ], 500);
        }

        if (!array_key_exists('allow_new_terms', $options)) {
            wp_send_json_error([
                'code'    => 'allow_new_terms_missing',
                'message' => __('A opção allow_new_terms não foi encontrada no metadado de Taxonomia.', 'tainacan-openalex'),
            ], 500);
        }

        $allow_new_terms_option = sanitize_key((string) $options['allow_new_terms']);

        if (!in_array($allow_new_terms_option, ['yes', 'no'], true)) {
            wp_send_json_error([
                'code'    => 'allow_new_terms_invalid',
                'message' => __('A opção allow_new_terms possui um valor inválido.', 'tainacan-openalex'),
            ], 500);
        }

        $allow_new_terms = $allow_new_terms_option === 'yes';

        try {
            $taxonomies_repository = \Tainacan\Repositories\Taxonomies::get_instance();
            $terms_repository = \Tainacan\Repositories\Terms::get_instance();
            $taxonomy = $taxonomies_repository->fetch($taxonomy_id);
        } catch (\Throwable $e) {
            $this->debug_openalex_resolution_error('Falha ao carregar taxonomia.', $e);

            wp_send_json_error([
                'code'    => 'taxonomy_repository_error',
                'message' => __('Não foi possível carregar a taxonomia associada.', 'tainacan-openalex'),
            ], 500);
        }

        if (!$taxonomy instanceof \Tainacan\Entities\Taxonomy) {
            wp_send_json_error([
                'code'    => 'taxonomy_not_found',
                'message' => __('A taxonomia associada ao metadado não existe.', 'tainacan-openalex'),
            ], 404);
        }

        $taxonomy_db_identifier = (string) $taxonomy->get_db_identifier();

        if ($taxonomy_db_identifier === '' || !taxonomy_exists($taxonomy_db_identifier)) {
            wp_send_json_error([
                'code'    => 'taxonomy_not_registered',
                'message' => __('A taxonomia associada não está registrada no WordPress.', 'tainacan-openalex'),
            ], 500);
        }

        $taxonomy_name = sanitize_text_field((string) $taxonomy->get_name());
        $taxonomy_allows_insert = (string) $taxonomy->get_allow_insert() === 'yes';
        $can_edit_taxonomy = $taxonomy->can_edit();

        // Mesma regra usada pelo endpoint nativo de termos do Tainacan:
        // editar a taxonomia OU editar o item quando metadado e taxonomia permitem inserção.
        $can_create_via_item = $item->can_edit() && $allow_new_terms && $taxonomy_allows_insert;
        $user_can_create_terms = $can_edit_taxonomy || $can_create_via_item;
        $can_create_terms = $allow_new_terms && $taxonomy_allows_insert && $user_can_create_terms;

        $term_ids = [];
        $resolved_terms = [];
        $warnings = [];

        foreach ($values as $input_value) {
            try {
                $matches = $this->find_exact_taxonomy_terms(
                    $terms_repository,
                    $taxonomy,
                    $taxonomy_id,
                    $input_value
                );
            } catch (\Throwable $e) {
                $this->debug_openalex_resolution_error('Falha ao procurar termo.', $e);

                $warnings[] = $this->make_taxonomy_warning(
                    $input_value,
                    'term_lookup_failed',
                    sprintf(
                        __('Não foi possível procurar o termo “%1$s” na taxonomia “%2$s”.', 'tainacan-openalex'),
                        $input_value,
                        $taxonomy_name
                    ),
                    $taxonomy_id,
                    $taxonomy_name
                );
                continue;
            }

            if (count($matches) > 1) {
                $candidates = [];

                foreach ($matches as $match) {
                    $candidates[] = [
                        'term_id'   => absint($match->get_id()),
                        'term_name' => sanitize_text_field((string) $match->get_name()),
                        'parent_id' => absint($match->get_parent()),
                    ];
                }

                $warning = $this->make_taxonomy_warning(
                    $input_value,
                    'ambiguous_term_name',
                    sprintf(
                        __('Existem vários termos chamados “%1$s” na taxonomia “%2$s”. Nenhum deles foi selecionado automaticamente.', 'tainacan-openalex'),
                        $input_value,
                        $taxonomy_name
                    ),
                    $taxonomy_id,
                    $taxonomy_name
                );
                $warning['candidates'] = $candidates;
                $warnings[] = $warning;
                continue;
            }

            if (count($matches) === 1) {
                $existing_term = $matches[0];
                $existing_term_id = absint($existing_term->get_id());

                if ($existing_term_id > 0 && !in_array($existing_term_id, $term_ids, true)) {
                    $term_ids[] = $existing_term_id;
                    $resolved_terms[] = [
                        'input_value' => $input_value,
                        'term_id'     => $existing_term_id,
                        'term_name'   => sanitize_text_field((string) $existing_term->get_name()),
                        'created'     => false,
                    ];
                }
                continue;
            }

            if (!$allow_new_terms) {
                $warnings[] = $this->make_taxonomy_warning(
                    $input_value,
                    'term_not_found_closed_vocabulary',
                    sprintf(
                        __('O termo “%1$s” não existe na taxonomia “%2$s” e novos termos não são permitidos.', 'tainacan-openalex'),
                        $input_value,
                        $taxonomy_name
                    ),
                    $taxonomy_id,
                    $taxonomy_name
                );
                continue;
            }

            if (!$taxonomy_allows_insert) {
                $warnings[] = $this->make_taxonomy_warning(
                    $input_value,
                    'taxonomy_disallows_term_creation',
                    sprintf(
                        __('O termo “%1$s” não existe e a taxonomia “%2$s” não permite a criação de termos.', 'tainacan-openalex'),
                        $input_value,
                        $taxonomy_name
                    ),
                    $taxonomy_id,
                    $taxonomy_name
                );
                continue;
            }

            if (!$user_can_create_terms) {
                $warnings[] = $this->make_taxonomy_warning(
                    $input_value,
                    'term_creation_forbidden',
                    sprintf(
                        __('O termo “%1$s” não existe e você não possui permissão para criá-lo na taxonomia “%2$s”.', 'tainacan-openalex'),
                        $input_value,
                        $taxonomy_name
                    ),
                    $taxonomy_id,
                    $taxonomy_name
                );
                continue;
            }

            if (!$can_create_terms) {
                $warnings[] = $this->make_taxonomy_warning(
                    $input_value,
                    'term_creation_not_available',
                    sprintf(
                        __('O termo “%1$s” não pôde ser criado na taxonomia “%2$s”.', 'tainacan-openalex'),
                        $input_value,
                        $taxonomy_name
                    ),
                    $taxonomy_id,
                    $taxonomy_name
                );
                continue;
            }

            // Segunda consulta reduz a janela de concorrência antes da inserção.
            $matches_before_insert = $this->find_exact_taxonomy_terms(
                $terms_repository,
                $taxonomy,
                $taxonomy_id,
                $input_value
            );

            if (count($matches_before_insert) === 1) {
                $term_created_elsewhere = $matches_before_insert[0];
                $term_created_elsewhere_id = absint($term_created_elsewhere->get_id());

                if ($term_created_elsewhere_id > 0 && !in_array($term_created_elsewhere_id, $term_ids, true)) {
                    $term_ids[] = $term_created_elsewhere_id;
                    $resolved_terms[] = [
                        'input_value' => $input_value,
                        'term_id'     => $term_created_elsewhere_id,
                        'term_name'   => sanitize_text_field((string) $term_created_elsewhere->get_name()),
                        'created'     => false,
                    ];
                }
                continue;
            }

            $new_term = new \Tainacan\Entities\Term();
            $new_term->set_name($input_value);
            $new_term->set_taxonomy($taxonomy_db_identifier);
            $new_term->set_parent(0);
            $new_term->set_description('');
            $new_term->set_user(get_current_user_id());

            if (!$new_term->validate()) {
                $warnings[] = $this->make_taxonomy_warning(
                    $input_value,
                    'term_validation_failed',
                    sprintf(
                        __('O valor “%1$s” não pôde ser usado como nome de termo na taxonomia “%2$s”.', 'tainacan-openalex'),
                        $input_value,
                        $taxonomy_name
                    ),
                    $taxonomy_id,
                    $taxonomy_name
                );
                continue;
            }

            try {
                $inserted_term = $terms_repository->insert($new_term);
            } catch (\Throwable $e) {
                // Pode ser uma criação concorrente. Procura novamente antes de falhar.
                try {
                    $matches_after_failure = $this->find_exact_taxonomy_terms(
                        $terms_repository,
                        $taxonomy,
                        $taxonomy_id,
                        $input_value
                    );
                } catch (\Throwable $lookup_error) {
                    $matches_after_failure = [];
                    $this->debug_openalex_resolution_error('Falha após erro de criação de termo.', $lookup_error);
                }

                if (count($matches_after_failure) === 1) {
                    $concurrent_term = $matches_after_failure[0];
                    $concurrent_term_id = absint($concurrent_term->get_id());

                    if ($concurrent_term_id > 0 && !in_array($concurrent_term_id, $term_ids, true)) {
                        $term_ids[] = $concurrent_term_id;
                        $resolved_terms[] = [
                            'input_value' => $input_value,
                            'term_id'     => $concurrent_term_id,
                            'term_name'   => sanitize_text_field((string) $concurrent_term->get_name()),
                            'created'     => false,
                        ];
                    }
                    continue;
                }

                $this->debug_openalex_resolution_error('Falha ao criar termo.', $e);

                $warnings[] = $this->make_taxonomy_warning(
                    $input_value,
                    'term_creation_failed',
                    sprintf(
                        __('Não foi possível criar o termo “%1$s” na taxonomia “%2$s”.', 'tainacan-openalex'),
                        $input_value,
                        $taxonomy_name
                    ),
                    $taxonomy_id,
                    $taxonomy_name
                );
                continue;
            }

            if (!$inserted_term instanceof \Tainacan\Entities\Term || absint($inserted_term->get_id()) <= 0) {
                $warnings[] = $this->make_taxonomy_warning(
                    $input_value,
                    'invalid_created_term',
                    sprintf(
                        __('A criação do termo “%1$s” na taxonomia “%2$s” não retornou um ID válido.', 'tainacan-openalex'),
                        $input_value,
                        $taxonomy_name
                    ),
                    $taxonomy_id,
                    $taxonomy_name
                );
                continue;
            }

            $inserted_term_id = absint($inserted_term->get_id());

            if (!in_array($inserted_term_id, $term_ids, true)) {
                $term_ids[] = $inserted_term_id;
                $resolved_terms[] = [
                    'input_value' => $input_value,
                    'term_id'     => $inserted_term_id,
                    'term_name'   => sanitize_text_field((string) $inserted_term->get_name()),
                    'created'     => true,
                ];
            }
        }

        if (!$metadatum->is_multiple() && count($term_ids) > 1) {
            $ignored_terms = array_slice($resolved_terms, 1);
            $term_ids = array_slice($term_ids, 0, 1);
            $resolved_terms = array_slice($resolved_terms, 0, 1);

            $warning = $this->make_taxonomy_warning(
                '',
                'metadatum_not_multiple',
                sprintf(
                    __('O metadado “%1$s” aceita apenas um valor. Somente o primeiro termo resolvido foi utilizado.', 'tainacan-openalex'),
                    sanitize_text_field((string) $metadatum->get_name())
                ),
                $taxonomy_id,
                $taxonomy_name
            );
            $warning['ignored_terms'] = $ignored_terms;
            $warnings[] = $warning;
        }

        wp_send_json_success([
            'success'                => true,
            'is_taxonomy'            => true,
            'metadatum_id'           => $metadatum_id,
            'metadatum_name'         => sanitize_text_field((string) $metadatum->get_name()),
            'is_multiple'            => $metadatum->is_multiple(),
            'taxonomy_id'            => $taxonomy_id,
            'taxonomy_name'          => $taxonomy_name,
            'allow_new_terms'        => $allow_new_terms,
            'taxonomy_allows_insert' => $taxonomy_allows_insert,
            'can_create_terms'       => $can_create_terms,
            'term_ids'               => array_values(array_map('absint', $term_ids)),
            'terms'                  => array_values($resolved_terms),
            'warnings'               => array_values($warnings),
        ]);
    }

    /**
     * Normaliza, remove vazios e elimina duplicatas textuais preservando a ordem.
     */
    private function normalize_openalex_metadata_values($raw_values): array {
        if (is_string($raw_values)) {
            $trimmed = trim($raw_values);
            $decoded = null;

            if ($trimmed !== '' && in_array($trimmed[0], ['[', '{'], true)) {
                $decoded = json_decode($trimmed, true);
            }

            $raw_values = is_array($decoded) ? $decoded : [$raw_values];
        } elseif (!is_array($raw_values)) {
            $raw_values = [$raw_values];
        }

        $normalized = [];
        $seen = [];

        foreach ($raw_values as $raw_value) {
            if (is_array($raw_value) || is_object($raw_value)) {
                continue;
            }

            $value = sanitize_text_field((string) $raw_value);
            $value = preg_replace('/\\s+/u', ' ', trim($value));

            if ($value === '') {
                continue;
            }

            $comparison_key = $this->normalize_openalex_term_key($value);

            if ($comparison_key === '' || isset($seen[$comparison_key])) {
                continue;
            }

            $seen[$comparison_key] = true;
            $normalized[] = $value;
        }

        return $normalized;
    }

    /**
     * Chave usada somente para comparação exata normalizada e deduplicação.
     */
    private function normalize_openalex_term_key(string $value): string {
        $value = preg_replace('/\\s+/u', ' ', trim(wp_specialchars_decode($value)));

        if (function_exists('mb_strtolower')) {
            return mb_strtolower($value, 'UTF-8');
        }

        return strtolower($value);
    }

    /**
     * Procura todos os termos com nome exato normalizado para detectar ambiguidades.
     * term_exists() é usado com o ID da taxonomia, nunca com o ID do metadado.
     *
     * @return array<int, \\Tainacan\\Entities\\Term>
     */
    private function find_exact_taxonomy_terms(
        $terms_repository,
        $taxonomy,
        int $taxonomy_id,
        string $input_value
    ): array {
        $first_match = $terms_repository->term_exists(
            $input_value,
            $taxonomy_id,
            null,
            true
        );

        if (!$first_match instanceof \WP_Term) {
            return [];
        }

        $fetched_terms = $terms_repository->fetch([
            'name'       => $input_value,
            'hide_empty' => false,
            'number'     => 0,
        ], $taxonomy);

        $expected_key = $this->normalize_openalex_term_key($input_value);
        $matches = [];
        $seen_ids = [];

        if (is_array($fetched_terms)) {
            foreach ($fetched_terms as $term) {
                if (!$term instanceof \Tainacan\Entities\Term) {
                    continue;
                }

                $term_id = absint($term->get_id());
                $term_key = $this->normalize_openalex_term_key((string) $term->get_name());

                if ($term_id > 0 && $term_key === $expected_key && !isset($seen_ids[$term_id])) {
                    $seen_ids[$term_id] = true;
                    $matches[] = $term;
                }
            }
        }

        // Compatibilidade defensiva caso a versão retorne apenas o resultado de term_exists().
        if (empty($matches)) {
            $fallback_term = new \Tainacan\Entities\Term($first_match);
            $fallback_id = absint($fallback_term->get_id());

            if ($fallback_id > 0) {
                $matches[] = $fallback_term;
            }
        }

        return $matches;
    }

    private function make_taxonomy_warning(
        string $input_value,
        string $code,
        string $message,
        int $taxonomy_id,
        string $taxonomy_name
    ): array {
        return [
            'input_value'  => $input_value,
            'code'         => sanitize_key($code),
            'message'      => sanitize_text_field($message),
            'taxonomy_id'  => $taxonomy_id,
            'taxonomy_name'=> $taxonomy_name,
        ];
    }

    /**
     * Impede que a action AJAX seja usada para um metadado arbitrário não mapeado.
     */
    private function is_configured_openalex_metadatum(int $metadatum_id): bool {
        foreach (array_keys($this->get_openalex_mapping_options()) as $option_id) {
            if (absint(get_option('tainacan_option_' . $option_id, 0)) === $metadatum_id) {
                return true;
            }
        }

        return false;
    }

    private function debug_openalex_resolution_error(string $message, \Throwable $error): void {
        if (defined('WP_DEBUG') && WP_DEBUG) {
            error_log(sprintf(
                '[Tainacan OpenAlex] %s %s',
                $message,
                $error->getMessage()
            ));
        }
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
        $this->ensure_openalex_collection_edit_permission();

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

    private function normalize_openalex_work_api_url(string $id): string {
        $id = trim($id);

        if ($id === '') {
            return '';
        }

        if (preg_match('~https?://api\.openalex\.org/works/([^/?#]+)~i', $id, $m)) {
            return 'https://api.openalex.org/works/' . strtoupper($m[1]);
        }

        if (preg_match('~^https?://openalex\.org/(W\d+)$~i', $id, $m)) {
            return 'https://api.openalex.org/works/' . strtoupper($m[1]);
        }

        if (preg_match('~^(W\d+)$~i', $id, $m)) {
            return 'https://api.openalex.org/works/' . strtoupper($m[1]);
        }

        return 'https://api.openalex.org/works/' . ltrim($id, '/');
    }



    public function ajax_work_get() {
        check_ajax_referer(self::NONCE_ACTION, 'nonce');
        $this->ensure_openalex_collection_edit_permission();

        $id = isset($_POST['id']) ? esc_url_raw(wp_unslash($_POST['id'])) : '';

        if (!$id) {
            wp_send_json_error(['message' => 'ID vazio.'], 400);
        }

        $api_key = $this->get_opt_str('openalex_api_key');

        $url = $this->normalize_openalex_work_api_url($id);

        if ($url === '') {
            wp_send_json_error([
                'message' => 'ID do work vazio ou inválido.',
                'id'      => $id,
            ], 400);
        }

        $args = [
            'select' => $this->get_openalex_work_select_fields(),
        ];

        if ($api_key !== '') {
            $args['api_key'] = $api_key;
        }

        $url = add_query_arg($args, $url);

        $resp = wp_remote_get($url, [
            'timeout' => 15,
            'headers' => [
                'Accept' => 'application/json',
            ],
        ]);

        if (is_wp_error($resp)) {
            wp_send_json_error([
                'message' => $resp->get_error_message(),
            ], 500);
        }

        $code = wp_remote_retrieve_response_code($resp);
        $body = wp_remote_retrieve_body($resp);

        if ($code < 200 || $code >= 300) {
            wp_send_json_error([
                'message'      => 'Erro ao obter detalhes do work no OpenAlex.',
                'status'       => $code,
                'openalex_url' => $url,
                'id_original'  => $id,
                'body'         => $body,
            ], 502);
        }

        $w = json_decode($body, true);

        if (!is_array($w)) {
            wp_send_json_error([
                'message' => 'Resposta inválida do OpenAlex.',
                'body'    => $body,
            ], 502);
        }

        $out = $this->normalize_work_item($w);

        wp_send_json_success([
            'work'  => $out,
            'debug' => [
                'openalex_url' => $url,
                'raw_id'       => $w['id'] ?? null,
                'raw_title'    => $w['title'] ?? null,
                'raw_year'     => $w['publication_year'] ?? null,
                'raw_doi'      => $w['doi'] ?? null,
                'raw_venue_primary_location' => $w['primary_location']['source']['display_name'] ?? null,
                'raw_locations_count'        => is_array($w['locations'] ?? null) ? count($w['locations']) : 0,
                'normalized_work'            => $out,
            ],
        ]);
    }

    private function get_openalex_work_select_fields(): string {
        return 'id,title,publication_year,doi,authorships,primary_location,locations';
    }

    private function search_works_by_text(string $query, string $api_key, string $mode = 'free'): array {
        $args = [
            'search'   => $query,
            'per-page' => 10,
            'select'   => $this->get_openalex_work_select_fields(),
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
            'select' => $this->get_openalex_work_select_fields(),
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
            'select'   => $this->get_openalex_work_select_fields(),
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
            'select'   => $this->get_openalex_work_select_fields(),
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
        $authors = [];

        foreach (($w['authorships'] ?? []) as $a) {
            $name = $a['author']['display_name'] ?? null;

            if ($name) {
                $authors[] = $name;
            }
        }

        $venue = $this->extract_openalex_venue($w);

        $out = [
            'id'           => $w['id'] ?? null,
            'title'        => $w['title'] ?? ($w['display_name'] ?? ''),
            'year'         => $w['publication_year'] ?? '',
            'doi'          => $w['doi'] ?? '',
            'venue'        => $venue,
            'authors'      => implode('; ', $authors),
            'authors_list' => array_values($authors),
            'url'          => $w['id'] ?? '',
        ];

        $out['abnt'] = $this->format_abnt_basic($out);

        return $out;
    }

    private function extract_short_openalex_id(string $id): string {
        $id = trim($id);
        if ($id === '') return '';

        $id = preg_replace('#^https?://openalex\.org/#i', '', $id);
        return strtoupper($id);
    }


    private function extract_openalex_venue(array $w): string {
        $candidates = [];

        if (!empty($w['primary_location']['source']['display_name'])) {
            $candidates[] = $w['primary_location']['source']['display_name'];
        }

        if (!empty($w['locations']) && is_array($w['locations'])) {
            foreach ($w['locations'] as $location) {
                if (!empty($location['source']['display_name'])) {
                    $candidates[] = $location['source']['display_name'];
                }
            }
        }

        foreach ($candidates as $candidate) {
            $candidate = trim((string) $candidate);

            if ($candidate !== '') {
                return $candidate;
            }
        }

        return '';
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

    private function get_openalex_references_collection_id(): int {
        return $this->get_opt_int('openalex_references_collection_id');
    }

    private function user_can_edit_openalex_collection(): bool {
        $collection_id = $this->get_openalex_references_collection_id();

        if ($collection_id <= 0) {
            return false;
        }

        if (class_exists('\\Tainacan\\Repositories\\Collections')) {
            try {
                $collection = \Tainacan\Repositories\Collections::get_instance()->fetch($collection_id);

                if ($collection instanceof \Tainacan\Entities\Collection) {
                    return (bool) $collection->user_can('edit_items');
                }
            } catch (\Throwable $e) {
                // Fallback to the raw capability check below.
            }
        }

        return current_user_can('tnc_col_' . $collection_id . '_edit_items');
    }

    private function ensure_openalex_collection_edit_permission(): void {
        $collection_id = $this->get_openalex_references_collection_id();

        if ($collection_id <= 0) {
            wp_send_json_error([
                'code'    => 'collection_not_configured',
                'message' => __('A coleção de referências OpenAlex não está configurada.', 'tainacan-openalex'),
            ], 400);
        }

        if (!$this->user_can_edit_openalex_collection()) {
            wp_send_json_error([
                'code'    => 'forbidden',
                'message' => __('Sem permissão para editar itens nesta coleção.', 'tainacan-openalex'),
            ], 403);
        }
    }

}

new Tainacan_OpenAlex_Biblio();

} // namespace
