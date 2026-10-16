import React, { useCallback, useEffect, useRef, useState } from 'react';
import useStore from './store';
import { t } from './i18n';

export default function TransferPackagesTab({
  API_URL,
  connections,
  flows,
  chains,
  canDeploy
}) {
  const transferPackageData = useStore(
    (state) => state.transferPackageData
  );
  const locale = useStore((state) => state.locale);

  const setTransferPackageData = useStore(
    (state) => state.setTransferPackageData
  );

  const { selectedTypes, importFile, uploadedPackage } = transferPackageData;

  const [loading, setLoading] = useState(false);
  const [validating, setValidating] = useState(false);
  const [applying, setApplying] = useState(false);
  const [exportError, setExportError] = useState('');
  const [importError, setImportError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [loadingImportState, setLoadingImportState] = useState(true);
  const [selectedObjectIds, setSelectedObjectIds] = useState({
    connections: [],
    flows: [],
    chains: [],
    python_files: []
  });

  const [pythonFiles, setPythonFiles] = useState([]);

  const getObjectKey = (type, item) =>
    type === 'python_files' ? item.path : item.id;

  const [selectionModal, setSelectionModal] = useState(null);
  const [selectionSearch, setSelectionSearch] = useState('');

  const fileInputRef = useRef(null);

  const [packages, setPackages] = useState([]);
  const [packagePage, setPackagePage] = useState(1);
  const [packagePages, setPackagePages] = useState(1);
  const [packageTotal, setPackageTotal] = useState(0);
  const [loadingPackages, setLoadingPackages] = useState(false);
  const [packagesError, setPackagesError] = useState('');
  const [packageActionError, setPackageActionError] = useState('');
  const [transferFeatures, setTransferFeatures] = useState({
    import_enabled: true,
    export_enabled: true,
    export_creation_enabled: true
  });

  const importEnabled = transferFeatures.import_enabled;
  const exportEnabled = transferFeatures.export_enabled;
  const exportCreationEnabled = transferFeatures.export_creation_enabled;

  useEffect(() => {
    const loadTransferFeatures = async () => {
      try {
        const response = await fetch(`${API_URL}/transfer-packages/config`);
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.detail || `HTTP ${response.status}`);
        }

        setTransferFeatures(data);
      } catch (error) {
        setPackagesError(
          `Ошибка получения настроек пакетов: ${error.message}`
        );
      }
    };

    loadTransferFeatures();
  }, [API_URL]);

  const loadPackages = useCallback(async (page) => {
    setLoadingPackages(true);
    setPackagesError('');

    try {
      const response = await fetch(
        `${API_URL}/transfer-packages?page=${page}&page_size=50`
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || `HTTP ${response.status}`);
      }

      setPackages(data.items);
      setPackagePages(data.pages);
      setPackageTotal(data.total);
    } catch (error) {
      setPackagesError(
        `Ошибка получения пакетов: ${error.message}`
      );
    } finally {
      setLoadingPackages(false);
    }
  }, [API_URL]);

  useEffect(() => {
    loadPackages(packagePage);
  }, [loadPackages, packagePage]);

  useEffect(() => {
    setTransferPackageData({
      selectedTypes: {
        connections: false,
        flows: false,
        chains: false,
        python_files: false
      }
    });
  }, [setTransferPackageData]);

  const toggleType = (type) => {
    const enabled = !selectedTypes[type];

    setTransferPackageData({
      selectedTypes: {
        ...selectedTypes,
        [type]: enabled
      }
    });

    setSelectedObjectIds((current) => ({
      ...current,
      [type]: enabled
        ? (
          type === 'connections'
            ? connections
            : type === 'flows'
              ? flows
              : type === 'chains'
                ? chains
                : pythonFiles
        ).map((item) => getObjectKey(type, item))
        : []
    }));
  };

  const getObjectsByType = (type) => {
    if (type === 'connections') return connections;
    if (type === 'flows') return flows;
    if (type === 'chains') return chains;
    return pythonFiles;
  };

  const openSelectionModal = async (type) => {
    setSelectionSearch('');

    if (type === 'python_files') {
      try {
        const response = await fetch(`${API_URL}/workspace/python-files`);
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.detail || `HTTP ${response.status}`);
        }

        setPythonFiles(data);
      } catch (error) {
        setPackagesError(
          `Ошибка получения Python-файлов: ${error.message}`
        );
        return;
      }
    }

    setSelectionModal(type);
  };

  const toggleObject = (type, id) => {
    setSelectedObjectIds((current) => {
      const selected = current[type];

      const nextSelected = selected.includes(id)
        ? selected.filter((itemId) => itemId !== id)
        : [...selected, id];

      setTransferPackageData({
        selectedTypes: {
          ...selectedTypes,
          [type]: nextSelected.length > 0
        }
      });

      return {
        ...current,
        [type]: nextSelected
      };
    });
  };

  const selectAllObjects = (type) => {
    setSelectedObjectIds((current) => ({
      ...current,
      [type]: getObjectsByType(type).map((item) => getObjectKey(type, item))
    }));
  };

  const clearAllObjects = (type) => {
    setSelectedObjectIds((current) => ({
      ...current,
      [type]: []
    }));
  };

  const createPackage = async () => {
    setLoading(true);
    setExportError('');

    try {
      const response = await fetch(`${API_URL}/transfer-packages/export`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          connection_ids: selectedObjectIds.connections,
          flow_ids: selectedObjectIds.flows,
          chain_ids: selectedObjectIds.chains,
          python_file_paths: selectedObjectIds.python_files
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || `HTTP ${response.status}`);
      }

      setTransferPackageData({
        createdPackage: data
      });
      await loadPackages(1);
      setPackagePage(1);
    } catch (error) {
      setExportError(`Ошибка: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const downloadPackage = async (packageItem) => {
    setPackageActionError('');

    try {
      const response = await fetch(
        `${API_URL}/transfer-packages/${packageItem.id}/download`
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');

      link.href = url;
      link.download = `BELT_${packageItem.environment}_${packageItem.package_uuid}.zip`;

      document.body.appendChild(link);
      link.click();

      const confirmResponse = await fetch(
        `${API_URL}/transfer-packages/${packageItem.id}/confirm-download`,
        { method: 'POST' }
      );
      const data = await confirmResponse.json();

      if (!confirmResponse.ok) {
        throw new Error(data.detail || `HTTP ${confirmResponse.status}`);
      }

      setPackages((current) =>
        current.map((item) =>
          item.id === packageItem.id
            ? { ...item, ...data }
            : item
        )
      );
      link.remove();

      window.setTimeout(() => {
        window.URL.revokeObjectURL(url);
      }, 1000);
    } catch (error) {
      setPackageActionError(`Ошибка скачивания: ${error.message}`);
    }
  };

  const uploadPackage = async () => {
    if (!importFile) return;

    if (importFile.size > 10 * 1024 * 1024) {
      setImportError('Размер импортируемого пакета не должен превышать 10 MiB');
      return;
    }

    setLoading(true);
    setImportError('');

    try {
      const formData = new FormData();
      formData.append('file', importFile);

      const response = await fetch(
        `${API_URL}/transfer-packages/upload`,
        {
          method: 'POST',
          body: formData
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || `HTTP ${response.status}`);
      }

      setTransferPackageData({
        uploadedPackage: data
      });
      await loadPackages(1);
      setPackagePage(1);
    } catch (error) {
      setImportError(`Ошибка загрузки: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const exportFromImport = async (importPackage) => {
    if (!importPackage) return;

    const upsertExportPack = (exportPackage) => {
      setPackages((current) => {
        const alreadyExists = current.some(
          (item) =>
            item.id === exportPackage.id ||
            (item.package_uuid === exportPackage.package_uuid &&
              item.direction === 'export')
        );

        if (alreadyExists) {
          return current.map((item) =>
            item.package_uuid === exportPackage.package_uuid &&
              item.direction === 'export'
              ? { ...item, ...exportPackage }
              : item
          );
        }

        return [
          {
            ...exportPackage,
            direction: 'export'
          },
          ...current
        ];
      });
    };

    const existingExport = packages.find(
      (item) =>
        item.package_uuid === importPackage.package_uuid &&
        item.direction === 'export'
    );

    if (existingExport) {
      upsertExportPack(existingExport);
      await loadPackages(1);
      setPackagePage(1);
      return;
    }

    setLoading(true);
    setPackageActionError('');

    try {
      const response = await fetch(
        `${API_URL}/transfer-packages/${importPackage.id}/export-from-import`,
        { method: 'POST' }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || `HTTP ${response.status}`);
      }

      const nextExportPackage = {
        ...data,
        direction: 'export'
      };

      upsertExportPack(nextExportPackage);
      await loadPackages(1);
      setPackagePage(1);
    } catch (error) {
      setPackageActionError(`Ошибка экспорта: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const validatePackage = async () => {
    if (!uploadedPackage) return;

    setValidating(true);
    setImportError('');

    try {
      const response = await fetch(
        `${API_URL}/transfer-packages/${uploadedPackage.id}/validate`,
        { method: 'POST' }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || `HTTP ${response.status}`);
      }

      setTransferPackageData({
        uploadedPackage: data
      });
      await loadPackages(1);
    } catch (error) {
      setImportError(`Ошибка проверки: ${error.message}`);
    } finally {
      setValidating(false);
    }
  };

  const applyPackage = async () => {
    if (!uploadedPackage) return;

    setApplying(true);
    setImportError('');

    try {
      const response = await fetch(
        `${API_URL}/transfer-packages/${uploadedPackage.id}/apply`,
        { method: 'POST' }
      );

      const responseText = await response.text();
      let data;

      try {
        data = JSON.parse(responseText);
      } catch {
        throw new Error(responseText || `HTTP ${response.status}`);
      }

      if (!response.ok) {
        throw new Error(data.detail || `HTTP ${response.status}`);
      }

      setTransferPackageData({
        uploadedPackage: {
          ...uploadedPackage,
          ...data
        }
      });
      await loadPackages(1);
    } catch (error) {
      setImportError(`Ошибка применения: ${error.message}`);
    } finally {
      setApplying(false);
    }
  };

  const deletePackage = async () => {
    if (!uploadedPackage) return;

    setDeleting(true);
    setImportError('');

    try {
      const response = await fetch(
        `${API_URL}/transfer-packages/${uploadedPackage.id}`,
        {
          method: 'DELETE'
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || `HTTP ${response.status}`);
      }

      setTransferPackageData({
        uploadedPackage: null,
        importFile: null
      });
      await loadPackages(1);
      setPackagePage(1);

      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (error) {
      setImportError(`Ошибка удаления: ${error.message}`);
    } finally {
      setDeleting(false);
    }
  };

  useEffect(() => {
    if (!canDeploy || !importEnabled) {
      setLoadingImportState(false);
      return;
    }

    const loadLatestImport = async () => {
      setLoadingImportState(true);
      setImportError('');

      try {
        const response = await fetch(
          `${API_URL}/transfer-packages/latest-import`
        );

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.detail || `HTTP ${response.status}`);
        }

        setTransferPackageData({
          uploadedPackage: data,
          importFile: null
        });
      } catch (error) {
        setImportError(
          `Ошибка получения состояния импорта: ${error.message}`
        );
      } finally {
        setLoadingImportState(false);
      }
    };

    loadLatestImport();
  }, [API_URL, canDeploy, importEnabled, setTransferPackageData]);

  const importStatus = uploadedPackage?.status || null;

  const step1Done = ['uploaded', 'validated', 'applied'].includes(importStatus);
  const step2Done = ['validated', 'applied'].includes(importStatus);
  const step3Done = importStatus === 'applied';

  const hasActivePackage =
    importStatus === 'uploaded' ||
    importStatus === 'validated';

  const modalObjects = selectionModal
    ? getObjectsByType(selectionModal)
    : [];

  const filteredModalObjects = modalObjects.filter((item) =>
    item.name
      .toLowerCase()
      .includes(selectionSearch.toLowerCase())
  );

  const selectedModalIds = selectionModal
    ? selectedObjectIds[selectionModal]
    : [];

  const objectSelectionButtonStyle = {
    background: 'var(--border-strong)',
    color: 'var(--text)',
    border: '1px solid var(--border-strong)'
  };

  return (
    <div style={{ padding: '20px', color: 'var(--text)' }}>
      <div style={{ display: 'flex', gap: '40px' }}>
        {canDeploy && importEnabled && (
          <div style={{ flex: 1 }}>
            <h3>{t(locale, 'common.deployImport')}</h3>

            {loadingImportState ? (
              <div style={{ marginTop: '20px' }}>
                {t(locale, 'common.deployLoadingState')}
              </div>
            ) : (
              <>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    marginTop: '25px',
                    marginBottom: '30px',
                    maxWidth: '650px'
                  }}
                >
                  {[
                    {
                      number: 1,
                      label: t(locale, 'common.deployUpload'),
                      done: step1Done
                    },
                    {
                      number: 2,
                      label: t(locale, 'common.deployValidate'),
                      done: step2Done
                    },
                    {
                      number: 3,
                      label: t(locale, 'common.deployApply'),
                      done: step3Done
                    }
                  ].map((step, index, steps) => (
                    <React.Fragment key={step.number}>
                      <div
                        style={{
                          width: '130px',
                          textAlign: 'center'
                        }}
                      >
                        <div
                          style={{
                            width: '34px',
                            height: '34px',
                            borderRadius: '50%',
                            margin: '0 auto',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontWeight: 'bold',
                            background: step.done
                              ? '#4caf50'
                              : '#ffffff',
                            color: step.done
                              ? '#ffffff'
                              : 'var(--text)',
                            border: step.done
                              ? '2px solid #4caf50'
                              : '2px solid var(--border)'
                          }}
                        >
                          {step.done ? '✓' : step.number}
                        </div>

                        <div
                          style={{
                            marginTop: '8px',
                            fontSize: '13px'
                          }}
                        >
                          {step.label}
                        </div>
                      </div>

                      {index < steps.length - 1 && (
                        <div
                          style={{
                            flex: 1,
                            height: '2px',
                            marginTop: '17px',
                            background:
                              steps[index + 1].done
                                ? '#4caf50'
                                : 'var(--border)'
                          }}
                        />
                      )}
                    </React.Fragment>
                  ))}
                </div>

                {!hasActivePackage && (
                  <>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".zip,application/zip"
                      onChange={(event) => {
                        setTransferPackageData({
                          importFile: event.target.files?.[0] || null
                        });
                      }}
                    />

                    <div style={{ marginTop: '20px' }}>
                      <button
                        className="belt-button belt-button-success"
                        onClick={uploadPackage}
                        disabled={!importFile || loading}
                      >
                        {loading ? t(locale, 'common.loading') : t(locale, 'common.deployUpload')}
                      </button>
                    </div>
                  </>
                )}

                {uploadedPackage && (
                  <div style={{ marginTop: '20px' }}>
                    Пакет: {uploadedPackage.package_uuid};   ID: {uploadedPackage.id};
                  </div>
                )}

                {uploadedPackage?.status === 'uploaded' && (
                  <div style={{ marginTop: '20px' }}>
                    <button
                      className="belt-button belt-button-success"
                      onClick={validatePackage}
                      disabled={validating}
                    >
                      {validating
                        ? `${t(locale, 'common.deployValidate')}...`
                        : t(locale, 'common.deployValidate')}
                    </button>

                    <button
                      className="belt-button"
                      onClick={deletePackage}
                      disabled={deleting}
                      style={{ marginLeft: '10px' }}
                    >
                      {deleting
                        ? `${t(locale, 'common.deployDelete')}...`
                        : t(locale, 'common.deployDelete')}
                    </button>
                  </div>
                )}

                {uploadedPackage?.status === 'validated' && (
                  <>
                    <div style={{ marginTop: '20px' }}>
                      Connections: {uploadedPackage.connections_count};
                      Flows: {uploadedPackage.flows_count};
                      Process chains: {uploadedPackage.chains_count}
                    </div>

                    <div style={{ marginTop: '20px' }}>
                      <button
                        className="belt-button belt-button-success"
                        onClick={applyPackage}
                        disabled={applying}
                      >
                        {applying
                          ? `${t(locale, 'common.deployApply')}...`
                          : t(locale, 'common.deployApply')}
                      </button>

                      <button
                        className="belt-button"
                        onClick={deletePackage}
                        disabled={deleting}
                        style={{ marginLeft: '10px' }}
                      >
                        {deleting
                          ? `${t(locale, 'common.deployDelete')}...`
                          : t(locale, 'common.deployDelete')}
                      </button>
                    </div>
                  </>
                )}

                {importError && (
                  <div
                    style={{
                      marginTop: '15px',
                      color: 'var(--danger)'
                    }}
                  >
                    {importError}
                  </div>
                )}
              </>
            )}
          </div>
        )}
        {canDeploy && exportEnabled && exportCreationEnabled && (
          <div style={{
            flex: 1, borderLeft: '1px solid var(--border)',
            paddingLeft: importEnabled ? '40px' : 0,
            borderLeft: importEnabled ? '1px solid var(--border)' : 'none'
          }}>
            <h3>{t(locale, 'common.deployExport')}</h3>

            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <label style={{ minWidth: '180px' }}>
                  <input
                    type="checkbox"
                    checked={selectedTypes.connections}
                    onChange={() => toggleType('connections')}
                  />
                  {' '}
                  {t(locale, 'common.deployConnections')} (
                  {selectedObjectIds.connections.length} / {connections.length}
                  )
                </label>

                <button
                  className="belt-button"
                  onClick={() => openSelectionModal('connections')}
                  style={objectSelectionButtonStyle}
                >
                  {t(locale, 'common.deploySelect')}
                </button>
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  marginTop: '6px'
                }}
              >
                <label style={{ minWidth: '180px' }}>
                  <input
                    type="checkbox"
                    checked={selectedTypes.flows}
                    onChange={() => toggleType('flows')}
                  />
                  {' '}
                  {t(locale, 'common.deployFlows')} (
                  {selectedObjectIds.flows.length} / {flows.length}
                  )
                </label>

                <button
                  className="belt-button"
                  onClick={() => openSelectionModal('flows')}
                  style={objectSelectionButtonStyle}
                >
                  {t(locale, 'common.deploySelect')}
                </button>
              </div>


              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  marginTop: '6px'
                }}
              >
                <label style={{ minWidth: '180px' }}>
                  <input
                    type="checkbox"
                    checked={selectedTypes.chains}
                    onChange={() => toggleType('chains')}
                  />
                  {' '}
                  {t(locale, 'common.deployChains')} (
                  {selectedObjectIds.chains.length} / {chains.length}
                  )
                </label>

                <button
                  className="belt-button"
                  onClick={() => openSelectionModal('chains')}
                  style={objectSelectionButtonStyle}
                >
                  {t(locale, 'common.deploySelect')}
                </button>
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  marginTop: '6px'
                }}
              >
                <label style={{ minWidth: '180px' }}>
                  <input
                    type="checkbox"
                    checked={selectedTypes.python_files}
                    onChange={() => toggleType('python_files')}
                  />
                  {' '}
                  {t(locale, 'common.deployScripts')} (
                  {selectedObjectIds.python_files.length} / {pythonFiles.length}
                  )
                </label>

                <button
                  className="belt-button"
                  onClick={() => openSelectionModal('python_files')}
                  style={objectSelectionButtonStyle}
                >
                  {t(locale, 'common.deploySelect')}
                </button>
              </div>

              <div style={{ marginTop: '20px' }}>
                <button
                  className="belt-button belt-button-success"
                  onClick={createPackage}
                  disabled={loading}
                >
                  {loading ? `${t(locale, 'common.deployBuild')}...` : t(locale, 'common.deployBuild')}
                </button>
              </div>

              <div>
                {exportError && (
                  <div style={{ marginTop: '15px', color: 'var(--danger)' }}>
                    {exportError}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}


      </div>

      {selectionModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.35)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000
          }}
          onClick={() => setSelectionModal(null)}
        >
          <div
            style={{
              width: '520px',
              maxHeight: '70vh',
              background: '#ffffff',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              padding: '20px',
              color: 'var(--text)'
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}
            >
              <h3 style={{ margin: 0 }}>
                {t(locale, 'common.deploySelect')} {
                  selectionModal === 'connections'
                    ? t(locale, 'common.deployConnections')
                    : selectionModal === 'flows'
                      ? t(locale, 'common.deployFlows')
                      : selectionModal === 'chains'
                        ? t(locale, 'common.deployChains')
                        : t(locale, 'common.deployWorkspaceFiles')
                }
              </h3>

              <button
                className="belt-button"
                onClick={() => setSelectionModal(null)}
                style={objectSelectionButtonStyle}
              >
                ×
              </button>
            </div>

            <input
              type="text"
              value={selectionSearch}
              onChange={(event) =>
                setSelectionSearch(event.target.value)
              }
              placeholder={t(locale, 'common.deploySearch')}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                marginTop: '20px',
                padding: '7px'
              }}
            />

            <div style={{ marginTop: '15px' }}>
              <button
                className="belt-button"
                onClick={() => selectAllObjects(selectionModal)}
                style={objectSelectionButtonStyle}
              >
                {t(locale, 'common.deploySelectAll')}
              </button>

              <button
                className="belt-button"
                onClick={() => clearAllObjects(selectionModal)}
                style={{ ...objectSelectionButtonStyle, marginLeft: '10px' }}
              >
                {t(locale, 'common.deployClearAll')}
              </button>
            </div>

            <div
              style={{
                marginTop: '15px',
                maxHeight: '320px',
                overflowY: 'auto',
                borderTop: '1px solid var(--border)',
                borderBottom: '1px solid var(--border)'
              }}
            >
              {filteredModalObjects.map((item) => (
                <label
                  key={getObjectKey(selectionModal, item)}
                  style={{
                    display: 'block',
                    padding: '8px 4px',
                    borderBottom: '1px solid var(--border)'
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedModalIds.includes(
                      getObjectKey(selectionModal, item)
                    )}
                    onChange={() =>
                      toggleObject(
                        selectionModal,
                        getObjectKey(selectionModal, item)
                      )
                    }
                  />

                  {' '}
                  {item.name}
                </label>
              ))}

              {filteredModalObjects.length === 0 && (
                <div style={{ padding: '15px 4px' }}>
                  {t(locale, 'common.deployNoResults')}
                </div>
              )}
            </div>

            <div
              style={{
                marginTop: '20px',
                textAlign: 'right'
              }}
            >
              <button
                className="belt-button belt-button-success"
                onClick={() => setSelectionModal(null)}
                style={objectSelectionButtonStyle}
              >
                {t(locale, 'common.apply')}
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ marginTop: '35px' }}>
        <h3 style={{ margin: '0 0 12px' }}>{t(locale, 'common.deployPackages')} ({packageTotal})</h3>

        {packagesError && (
          <div
            style={{
              marginBottom: '15px',
              color: 'var(--danger)'
            }}
          >
            {packagesError}
          </div>
        )}

        {packageActionError && (
          <div
            style={{
              marginBottom: '15px',
              color: 'var(--danger)'
            }}
          >
            {packageActionError}
          </div>
        )}

        <div style={{ maxHeight: '420px', overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '8px 10px' }}>Package UUID</th>
                <th style={{ textAlign: 'left', padding: '8px 10px', minWidth: '180px' }}>Status</th>
                <th style={{ textAlign: 'left', padding: '8px 10px' }}>{t(locale, 'common.deployAction')}</th>
              </tr>
            </thead>

            <tbody>
              {packages.map((packageItem) => {
                const renderCell = (item) => {
                  const statusLabel = item.status || '—';
                  const isComplete =
                    (item.environment === 'PROD' && statusLabel === 'applied') ||
                    (item.environment !== 'PROD' && statusLabel === 'downloaded');
                  const isError = statusLabel === 'error';
                  const statusColor = isError ? '#ffe8e8' : isComplete ? '#e6fff3' : '#fff4cc';
                  const statusText = isError ? '#b42318' : isComplete ? '#0f8f6b' : '#9a6a00';
                  const historySteps = item.environment === 'DEV'
                    ? [
                        ['Created', item.created_at],
                        ['Downloaded', item.downloaded_at]
                      ]
                    : [
                        ['Uploaded', item.created_at],
                        ['Validated', item.validated_at],
                        ['Applied', item.applied_at],
                        ...(item.environment === 'TEST'
                          ? [['Downloaded', item.downloaded_at]]
                          : [])
                      ];
                  const history = historySteps
                    .filter(([, timestamp]) => timestamp)
                    .map(([label, timestamp]) =>
                      `✓ ${label}  ${new Date(timestamp).toLocaleString()}`
                    )
                    .join('\n');
                  const tooltip = item.error_message
                    ? `${history}\nError: ${item.error_message}`
                    : history;

                  return (
                    <div>
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '4px 8px',
                          borderRadius: '999px',
                          background: statusColor,
                          color: statusText,
                          fontWeight: 600,
                          fontSize: '12px'
                        }}
                        title={tooltip}
                      >
                        {statusLabel}
                      </span>
                      <div
                        style={{
                          marginTop: '8px',
                          fontSize: '12px',
                          color: 'var(--muted)'
                        }}
                      >
                        {new Date(item.created_at).toLocaleString()}
                      </div>
                    </div>
                  );
                };

                const canDownload =
                  (packageItem.direction === 'export' &&
                    ['ready', 'downloaded'].includes(packageItem.status)) ||
                  (['DEV', 'TEST'].includes(packageItem.environment) &&
                    packageItem.direction === 'import' &&
                    ['applied', 'downloaded'].includes(packageItem.status));

                return (
                  <tr key={packageItem.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '10px', verticalAlign: 'top', wordBreak: 'break-all' }}>
                      {packageItem.package_uuid}
                    </td>
                    <td style={{ padding: '10px', verticalAlign: 'top' }}>
                      {renderCell(packageItem)}
                    </td>
                    <td style={{ padding: '10px', verticalAlign: 'top' }}>
                      {canDeploy && canDownload ? (
                        <button
                          className="belt-button"
                          onClick={() => downloadPackage(packageItem)}
                        >
                          {t(locale, 'common.deployDownload')}
                        </button>
                      ) : (
                        <span style={{ color: 'var(--muted)' }}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {loadingPackages && (
          <div style={{ marginTop: '15px' }}>
            {t(locale, 'common.loading')}
          </div>
        )}

        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            alignItems: 'center',
            gap: '8px',
            marginTop: '15px'
          }}
        >
          <span>
            {t(locale, 'common.deployPage')} {packagePage} {t(locale, 'common.deployOf')} {packagePages}
          </span>

          <button
            className="belt-button"
            onClick={() => setPackagePage((current) => current - 1)}
            disabled={packagePage <= 1 || loadingPackages}
            title={`${t(locale, 'common.deployPage')} - 1`}
          >
            ←
          </button>

          <button
            className="belt-button"
            onClick={() => setPackagePage((current) => current + 1)}
            disabled={packagePage >= packagePages || loadingPackages}
            title={`${t(locale, 'common.deployPage')} + 1`}
          >
            →
          </button>
        </div>
      </div>

    </div >
  );
}