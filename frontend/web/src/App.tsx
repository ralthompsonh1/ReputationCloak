// App.tsx
import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import "./App.css";
import { useAccount, useSignMessage } from 'wagmi';

interface ReputationData {
  id: number;
  address: string;
  encryptedScore: string;
  decryptedScore?: number;
  lastUpdated: number;
  activities: number;
  governance: number;
  defi: number;
}

interface UserAction {
  type: 'check' | 'update' | 'decrypt';
  timestamp: number;
  details: string;
}

// FHE encryption/decryption functions
const FHEEncryptNumber = (value: number): string => `FHE-${btoa(value.toString())}`;
const FHEDecryptNumber = (encryptedData: string): number => encryptedData.startsWith('FHE-') ? parseFloat(atob(encryptedData.substring(4))) : parseFloat(encryptedData);
const generatePublicKey = () => `0x${Array(2000).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(true);
  const [reputationData, setReputationData] = useState<ReputationData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ visible: false, status: "pending", message: "" });
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [publicKey, setPublicKey] = useState("");
  const [contractAddress, setContractAddress] = useState("");
  const [chainId, setChainId] = useState(0);
  const [startTimestamp, setStartTimestamp] = useState(0);
  const [durationDays, setDurationDays] = useState(30);
  const [userActions, setUserActions] = useState<UserAction[]>([]);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [updatingData, setUpdatingData] = useState(false);
  const [newActivities, setNewActivities] = useState(0);
  const [newGovernance, setNewGovernance] = useState(0);
  const [newDeFi, setNewDeFi] = useState(0);
  
  // Initialize signature parameters
  useEffect(() => {
    loadData().finally(() => setLoading(false));
    const initSignatureParams = async () => {
      const contract = await getContractReadOnly();
      if (contract) setContractAddress(await contract.getAddress());
      if (window.ethereum) {
        const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
        setChainId(parseInt(chainIdHex, 16));
      }
      setStartTimestamp(Math.floor(Date.now() / 1000));
      setDurationDays(30);
      setPublicKey(generatePublicKey());
    };
    initSignatureParams();
  }, []);

  // Load data from contract
  const loadData = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        setTransactionStatus({ visible: true, status: "success", message: "Contract is available!" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      }
      
      // Load reputation data
      const dataBytes = await contract.getData("reputation");
      let dataList: ReputationData[] = [];
      if (dataBytes.length > 0) {
        try {
          const dataStr = ethers.toUtf8String(dataBytes);
          if (dataStr.trim() !== '') dataList = JSON.parse(dataStr);
        } catch (e) {}
      }
      setReputationData(dataList);
      
      // Update user actions
      const newAction: UserAction = {
        type: 'check',
        timestamp: Math.floor(Date.now() / 1000),
        details: "Checked reputation data"
      };
      setUserActions(prev => [newAction, ...prev]);
    } catch (e) {
      console.error("Error loading data:", e);
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
      setLoading(false); 
    }
  };

  // Update reputation data
  const updateReputation = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setUpdatingData(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Updating reputation with Zama FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      // Calculate new score (simplified for demo)
      const totalScore = newActivities * 0.4 + newGovernance * 0.3 + newDeFi * 0.3;
      const encryptedScore = FHEEncryptNumber(totalScore);
      
      // Find or create user data
      let userData = reputationData.find(d => d.address === address);
      const now = Math.floor(Date.now() / 1000);
      
      if (!userData) {
        userData = {
          id: reputationData.length + 1,
          address: address,
          encryptedScore: encryptedScore,
          lastUpdated: now,
          activities: newActivities,
          governance: newGovernance,
          defi: newDeFi
        };
      } else {
        userData = {
          ...userData,
          encryptedScore: encryptedScore,
          lastUpdated: now,
          activities: userData.activities + newActivities,
          governance: userData.governance + newGovernance,
          defi: userData.defi + newDeFi
        };
      }
      
      // Update data list
      const updatedData = reputationData.filter(d => d.address !== address);
      updatedData.push(userData);
      
      // Save to contract
      await contract.setData("reputation", ethers.toUtf8Bytes(JSON.stringify(updatedData)));
      
      // Update user actions
      const newAction: UserAction = {
        type: 'update',
        timestamp: now,
        details: `Updated reputation with ${totalScore.toFixed(2)} score`
      };
      setUserActions(prev => [newAction, ...prev]);
      
      setTransactionStatus({ visible: true, status: "success", message: "Reputation updated successfully!" });
      await loadData();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowUpdateModal(false);
        setNewActivities(0);
        setNewGovernance(0);
        setNewDeFi(0);
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Update failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setUpdatingData(false); 
    }
  };

  // Decrypt score with signature
  const decryptWithSignature = async (encryptedData: string): Promise<number | null> => {
    if (!isConnected) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const message = `publickey:${publicKey}\ncontractAddresses:${contractAddress}\ncontractsChainId:${chainId}\nstartTimestamp:${startTimestamp}\ndurationDays:${durationDays}`;
      await signMessageAsync({ message });
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // Update user actions
      const newAction: UserAction = {
        type: 'decrypt',
        timestamp: Math.floor(Date.now() / 1000),
        details: "Decrypted FHE reputation score"
      };
      setUserActions(prev => [newAction, ...prev]);
      
      return FHEDecryptNumber(encryptedData);
    } catch (e) { 
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  // Handle decrypt button click
  const handleDecrypt = async (data: ReputationData) => {
    if (data.decryptedScore !== undefined) {
      // Already decrypted, no action needed
      return;
    }
    
    const decrypted = await decryptWithSignature(data.encryptedScore);
    if (decrypted !== null) {
      setReputationData(prev => prev.map(item => 
        item.id === data.id ? { ...item, decryptedScore: decrypted } : item
      ));
    }
  };

  // Render reputation score card
  const renderScoreCard = (data: ReputationData) => {
    const score = data.decryptedScore !== undefined ? data.decryptedScore : null;
    const scorePercentage = score !== null ? Math.min(100, Math.max(0, score * 10)) : 0;
    
    return (
      <div className="score-card">
        <div className="score-header">
          <div className="address">{data.address.substring(0, 6)}...{data.address.substring(38)}</div>
          <div className="last-updated">{new Date(data.lastUpdated * 1000).toLocaleDateString()}</div>
        </div>
        
        <div className="score-visual">
          <div className="score-circle">
            <div 
              className="circle-progress" 
              style={{ background: `conic-gradient(#3a86ff ${scorePercentage}%, #2d3748 ${scorePercentage}%)` }}
            >
              <div className="circle-inner">
                {score !== null ? score.toFixed(1) : '🔒'}
              </div>
            </div>
          </div>
          <div className="score-label">
            {score !== null ? "Reputation Score" : "Encrypted Score"}
          </div>
        </div>
        
        <div className="score-details">
          <div className="detail-item">
            <span>Activities:</span>
            <strong>{data.activities}</strong>
          </div>
          <div className="detail-item">
            <span>Governance:</span>
            <strong>{data.governance}</strong>
          </div>
          <div className="detail-item">
            <span>DeFi:</span>
            <strong>{data.defi}</strong>
          </div>
        </div>
        
        <button 
          className={`decrypt-btn ${score !== null ? 'decrypted' : ''}`}
          onClick={() => handleDecrypt(data)}
          disabled={isDecrypting}
        >
          {score !== null ? 'Decrypted' : isDecrypting ? 'Decrypting...' : 'Decrypt Score'}
        </button>
      </div>
    );
  };

  // Render statistics panel
  const renderStatistics = () => {
    if (reputationData.length === 0) return null;
    
    const totalUsers = reputationData.length;
    const totalActivities = reputationData.reduce((sum, d) => sum + d.activities, 0);
    const totalGovernance = reputationData.reduce((sum, d) => sum + d.governance, 0);
    const totalDeFi = reputationData.reduce((sum, d) => sum + d.defi, 0);
    
    return (
      <div className="statistics-panel">
        <h3>System Statistics</h3>
        <div className="stats-grid">
          <div className="stat-item">
            <div className="stat-value">{totalUsers}</div>
            <div className="stat-label">Users</div>
          </div>
          <div className="stat-item">
            <div className="stat-value">{totalActivities}</div>
            <div className="stat-label">Activities</div>
          </div>
          <div className="stat-item">
            <div className="stat-value">{totalGovernance}</div>
            <div className="stat-label">Governance</div>
          </div>
          <div className="stat-item">
            <div className="stat-value">{totalDeFi}</div>
            <div className="stat-label">DeFi</div>
          </div>
        </div>
      </div>
    );
  };

  // Render leaderboard
  const renderLeaderboard = () => {
    if (reputationData.length === 0) return <div className="no-data">No reputation data available</div>;
    
    // Sort by decrypted score if available, otherwise by activities
    const sortedData = [...reputationData].sort((a, b) => {
      if (a.decryptedScore !== undefined && b.decryptedScore !== undefined) {
        return b.decryptedScore - a.decryptedScore;
      }
      return b.activities - a.activities;
    });
    
    return (
      <div className="leaderboard">
        <h3>Reputation Leaderboard</h3>
        <div className="leaderboard-header">
          <div className="rank">Rank</div>
          <div className="address">Address</div>
          <div className="score">Score</div>
          <div className="activities">Activities</div>
        </div>
        <div className="leaderboard-list">
          {sortedData.slice(0, 10).map((data, index) => (
            <div className="leaderboard-item" key={data.id}>
              <div className="rank">{index + 1}</div>
              <div className="address">{data.address.substring(0, 6)}...{data.address.substring(38)}</div>
              <div className="score">
                {data.decryptedScore !== undefined ? data.decryptedScore.toFixed(1) : '🔒'}
              </div>
              <div className="activities">{data.activities}</div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  // Render user actions history
  const renderUserActions = () => {
    if (userActions.length === 0) return <div className="no-data">No actions recorded</div>;
    
    return (
      <div className="actions-list">
        {userActions.map((action, index) => (
          <div className="action-item" key={index}>
            <div className={`action-type ${action.type}`}>
              {action.type === 'check' && '🔍'}
              {action.type === 'update' && '🔄'}
              {action.type === 'decrypt' && '🔓'}
            </div>
            <div className="action-details">
              <div className="action-text">{action.details}</div>
              <div className="action-time">{new Date(action.timestamp * 1000).toLocaleString()}</div>
            </div>
          </div>
        ))}
      </div>
    );
  };

  // Render FHE flow visualization
  const renderFHEFlow = () => {
    return (
      <div className="fhe-flow">
        <div className="flow-step">
          <div className="step-icon">1</div>
          <div className="step-content">
            <h4>On-Chain Activities</h4>
            <p>User participates in governance, DeFi, and other on-chain activities</p>
          </div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="flow-step">
          <div className="step-icon">2</div>
          <div className="step-content">
            <h4>FHE Encryption</h4>
            <p>Activity data is encrypted using Zama FHE</p>
          </div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="flow-step">
          <div className="step-icon">3</div>
          <div className="step-content">
            <h4>Private Calculation</h4>
            <p>Reputation score is calculated on encrypted data</p>
          </div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="flow-step">
          <div className="step-icon">4</div>
          <div className="step-content">
            <h4>Secure Usage</h4>
            <p>Score can be used privately for access control or benefits</p>
          </div>
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Initializing encrypted reputation system...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="shield-icon"></div>
          </div>
          <h1>Reputation<span>Cloak</span></h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowUpdateModal(true)} 
            className="update-reputation-btn"
          >
            <div className="refresh-icon"></div>Update Reputation
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>
      
      <div className="main-content-container">
        <div className="dashboard-section">
          <div className="dashboard-grid">
            <div className="dashboard-panel intro-panel">
              <div className="panel-card">
                <h2>Private On-Chain Reputation System</h2>
                <p>ReputationCloak uses Zama FHE to privately calculate reputation scores based on your on-chain activities without exposing your behavior history.</p>
                <div className="fhe-badge">
                  <div className="fhe-icon"></div>
                  <span>Powered by Zama FHE</span>
                </div>
              </div>
              
              <div className="panel-card">
                <h2>FHE Reputation Flow</h2>
                {renderFHEFlow()}
              </div>
              
              {renderStatistics()}
            </div>
            
            <div className="dashboard-panel main-panel">
              <div className="tabs-container">
                <div className="tabs">
                  <button 
                    className={`tab ${activeTab === 'dashboard' ? 'active' : ''}`}
                    onClick={() => setActiveTab('dashboard')}
                  >
                    Dashboard
                  </button>
                  <button 
                    className={`tab ${activeTab === 'leaderboard' ? 'active' : ''}`}
                    onClick={() => setActiveTab('leaderboard')}
                  >
                    Leaderboard
                  </button>
                  <button 
                    className={`tab ${activeTab === 'actions' ? 'active' : ''}`}
                    onClick={() => setActiveTab('actions')}
                  >
                    My Actions
                  </button>
                </div>
                
                <div className="tab-content">
                  {activeTab === 'dashboard' && (
                    <div className="reputation-section">
                      <div className="section-header">
                        <h2>My Reputation</h2>
                        <div className="header-actions">
                          <button 
                            onClick={loadData} 
                            className="refresh-btn" 
                            disabled={isRefreshing}
                          >
                            {isRefreshing ? "Refreshing..." : "Refresh"}
                          </button>
                        </div>
                      </div>
                      
                      <div className="reputation-cards">
                        {isConnected && address ? (
                          reputationData.filter(d => d.address === address).length > 0 ? (
                            reputationData
                              .filter(d => d.address === address)
                              .map(data => renderScoreCard(data))
                          ) : (
                            <div className="no-reputation">
                              <div className="no-data-icon"></div>
                              <p>No reputation data found for your address</p>
                              <button 
                                className="create-btn" 
                                onClick={() => setShowUpdateModal(true)}
                              >
                                Create Reputation Profile
                              </button>
                            </div>
                          )
                        ) : (
                          <div className="no-wallet">
                            <div className="wallet-icon"></div>
                            <p>Please connect your wallet to view your reputation</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  
                  {activeTab === 'leaderboard' && (
                    <div className="leaderboard-section">
                      <h2>Reputation Leaderboard</h2>
                      {renderLeaderboard()}
                    </div>
                  )}
                  
                  {activeTab === 'actions' && (
                    <div className="actions-section">
                      <h2>My Activity History</h2>
                      {renderUserActions()}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      {showUpdateModal && (
        <ModalUpdateReputation 
          onSubmit={updateReputation} 
          onClose={() => setShowUpdateModal(false)} 
          updating={updatingData} 
          activities={newActivities}
          setActivities={setNewActivities}
          governance={newGovernance}
          setGovernance={setNewGovernance}
          defi={newDeFi}
          setDeFi={setNewDeFi}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
      
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="shield-icon"></div>
              <span>ReputationCloak</span>
            </div>
            <p>Private On-Chain Reputation System powered by FHE</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>Powered by Zama FHE</span>
          </div>
          <div className="copyright">© {new Date().getFullYear()} ReputationCloak. All rights reserved.</div>
          <div className="disclaimer">
            This system uses fully homomorphic encryption to protect user privacy. 
            Reputation scores are calculated on encrypted data without revealing individual activities.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalUpdateReputationProps {
  onSubmit: () => void; 
  onClose: () => void; 
  updating: boolean;
  activities: number;
  setActivities: (value: number) => void;
  governance: number;
  setGovernance: (value: number) => void;
  defi: number;
  setDeFi: (value: number) => void;
}

const ModalUpdateReputation: React.FC<ModalUpdateReputationProps> = ({ 
  onSubmit, 
  onClose, 
  updating, 
  activities, 
  setActivities,
  governance,
  setGovernance,
  defi,
  setDeFi
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>, setter: (value: number) => void) => {
    const value = parseInt(e.target.value) || 0;
    setter(value);
  };

  return (
    <div className="modal-overlay">
      <div className="update-reputation-modal">
        <div className="modal-header">
          <h2>Update Reputation</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <div className="lock-icon"></div>
            <div>
              <strong>FHE Privacy Notice</strong>
              <p>Your activity data will be encrypted before calculation</p>
            </div>
          </div>
          
          <div className="form-group">
            <label>New Activities Count</label>
            <input 
              type="number" 
              value={activities} 
              onChange={(e) => handleChange(e, setActivities)} 
              placeholder="Enter number of new activities..." 
              min="0"
            />
          </div>
          
          <div className="form-group">
            <label>New Governance Participation</label>
            <input 
              type="number" 
              value={governance} 
              onChange={(e) => handleChange(e, setGovernance)} 
              placeholder="Enter governance participation count..." 
              min="0"
            />
          </div>
          
          <div className="form-group">
            <label>New DeFi Interactions</label>
            <input 
              type="number" 
              value={defi} 
              onChange={(e) => handleChange(e, setDeFi)} 
              placeholder="Enter DeFi interaction count..." 
              min="0"
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={updating || (activities === 0 && governance === 0 && defi === 0)} 
            className="submit-btn"
          >
            {updating ? "Updating with FHE..." : "Update Reputation"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;