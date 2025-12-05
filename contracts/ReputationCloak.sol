pragma solidity ^0.8.24;
import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract ReputationCloakFHE is SepoliaConfig {
    using FHE for euint32;
    using FHE for ebool;

    error NotOwner();
    error NotProvider();
    error Paused();
    error CooldownActive();
    error BatchNotOpen();
    error BatchAlreadyOpen();
    error InvalidBatchId();
    error InvalidCooldown();
    error ReplayDetected();
    error StateMismatch();
    error InvalidProof();
    error NotInitialized();
    error InvalidDecryptionRequest();

    event ProviderAdded(address indexed provider);
    event ProviderRemoved(address indexed provider);
    event ContractPaused(address indexed account);
    event ContractUnpaused(address indexed account);
    event CooldownSet(uint256 oldCooldownSeconds, uint256 newCooldownSeconds);
    event BatchOpened(uint256 indexed batchId);
    event BatchClosed(uint256 indexed batchId);
    event ReputationDataSubmitted(address indexed user, uint256 indexed batchId, bytes32 encryptedScore);
    event DecryptionRequested(uint256 indexed requestId, uint256 indexed batchId, bytes32 stateHash);
    event DecryptionCompleted(uint256 indexed requestId, uint256 indexed batchId, uint256 reputationScore);

    struct DecryptionContext {
        uint256 batchId;
        bytes32 stateHash;
        bool processed;
    }

    address public owner;
    mapping(address => bool) public isProvider;
    bool public paused;
    uint256 public cooldownSeconds;
    mapping(address => uint256) public lastSubmissionTime;
    mapping(address => uint256) public lastDecryptionRequestTime;

    uint256 public currentBatchId;
    bool public batchOpen;
    mapping(uint256 => euint32) public encryptedReputationScores;
    mapping(uint256 => DecryptionContext) public decryptionContexts;

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyProvider() {
        if (!isProvider[msg.sender]) revert NotProvider();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    modifier checkSubmissionCooldown() {
        if (block.timestamp < lastSubmissionTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        _;
    }

    modifier checkDecryptionCooldown() {
        if (block.timestamp < lastDecryptionRequestTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        _;
    }

    constructor() {
        owner = msg.sender;
        isProvider[msg.sender] = true;
        emit ProviderAdded(msg.sender);
        cooldownSeconds = 60; // Default cooldown
    }

    function addProvider(address _provider) external onlyOwner {
        if (!isProvider[_provider]) {
            isProvider[_provider] = true;
            emit ProviderAdded(_provider);
        }
    }

    function removeProvider(address _provider) external onlyOwner {
        if (isProvider[_provider]) {
            isProvider[_provider] = false;
            emit ProviderRemoved(_provider);
        }
    }

    function pause() external onlyOwner whenNotPaused {
        paused = true;
        emit ContractPaused(msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit ContractUnpaused(msg.sender);
    }

    function setCooldownSeconds(uint256 _cooldownSeconds) external onlyOwner {
        if (_cooldownSeconds == 0) revert InvalidCooldown();
        emit CooldownSet(cooldownSeconds, _cooldownSeconds);
        cooldownSeconds = _cooldownSeconds;
    }

    function openBatch() external onlyOwner whenNotPaused {
        if (batchOpen) revert BatchAlreadyOpen();
        batchOpen = true;
        currentBatchId++;
        emit BatchOpened(currentBatchId);
    }

    function closeBatch() external onlyOwner whenNotPaused {
        if (!batchOpen) revert BatchNotOpen();
        batchOpen = false;
        emit BatchClosed(currentBatchId);
    }

    function submitReputationScore(euint32 _encryptedScore) external onlyProvider whenNotPaused checkSubmissionCooldown {
        if (!batchOpen) revert BatchNotOpen();
        if (!_encryptedScore.isInitialized()) revert NotInitialized();

        encryptedReputationScores[currentBatchId] = _encryptedScore;
        lastSubmissionTime[msg.sender] = block.timestamp;
        emit ReputationDataSubmitted(msg.sender, currentBatchId, _encryptedScore.toBytes32());
    }

    function requestReputationScoreDecryption(uint256 _batchId) external onlyOwner whenNotPaused checkDecryptionCooldown {
        if (_batchId == 0 || _batchId > currentBatchId) revert InvalidBatchId();
        if (!encryptedReputationScores[_batchId].isInitialized()) revert NotInitialized();

        euint32 memory score = encryptedReputationScores[_batchId];

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = score.toBytes32();

        bytes32 stateHash = _hashCiphertexts(cts);
        uint256 requestId = FHE.requestDecryption(cts, this.myCallback.selector);

        decryptionContexts[requestId] = DecryptionContext({
            batchId: _batchId,
            stateHash: stateHash,
            processed: false
        });

        lastDecryptionRequestTime[msg.sender] = block.timestamp;
        emit DecryptionRequested(requestId, _batchId, stateHash);
    }

    function myCallback(uint256 requestId, bytes memory cleartexts, bytes memory proof) public {
        if (decryptionContexts[requestId].processed) revert ReplayDetected();

        uint256 batchId = decryptionContexts[requestId].batchId;
        euint32 storage score = encryptedReputationScores[batchId];

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = score.toBytes32();

        bytes32 currentHash = _hashCiphertexts(cts);
        if (currentHash != decryptionContexts[requestId].stateHash) {
            revert StateMismatch();
        }

        if (!FHE.checkSignatures(requestId, cleartexts, proof)) {
            revert InvalidProof();
        }

        uint256 reputationScore = abi.decode(cleartexts, (uint256));
        decryptionContexts[requestId].processed = true;
        emit DecryptionCompleted(requestId, batchId, reputationScore);
    }

    function _hashCiphertexts(bytes32[] memory cts) internal pure returns (bytes32) {
        return keccak256(abi.encode(cts, address(this)));
    }

    function _initIfNeeded(euint32 storage _var) internal {
        if (!_var.isInitialized()) {
            _var = FHE.asEuint32(0);
        }
    }

    function _requireInitialized(euint32 storage _var) internal view {
        if (!_var.isInitialized()) {
            revert NotInitialized();
        }
    }
}