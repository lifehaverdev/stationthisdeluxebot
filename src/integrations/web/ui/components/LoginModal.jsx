import React, { useState } from 'react';
import { Modal, Button, Form, Alert, Tabs, Tab, Spinner } from 'react-bootstrap';

/**
 * Login Modal Component
 * Handles user authentication via API key, wallet connection, or guest mode
 */
const LoginModal = ({ 
  show, 
  onLogin, 
  onCancel,
  apiService
}) => {
  const [activeTab, setActiveTab] = useState('apiKey');
  const [apiKey, setApiKey] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [walletAddress, setWalletAddress] = useState('');
  const [nonce, setNonce] = useState('');
  
  // Handle API key login
  const handleApiKeyLogin = async (e) => {
    e.preventDefault();
    
    if (!apiKey) {
      setError('API key is required');
      return;
    }
    
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await apiService.validateApiKey(apiKey);
      
      if (!response.success) {
        throw new Error(response.error || 'Invalid API key');
      }
      
      onLogin({
        method: 'apiKey',
        apiKey,
        session: response.session
      });
    } catch (error) {
      setError(error.message || 'Failed to validate API key');
    } finally {
      setIsLoading(false);
    }
  };
  
  // Handle wallet connection
  const handleWalletConnect = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      // Check if wallet is available
      if (typeof window.ethereum === 'undefined') {
        throw new Error('Wallet not detected. Please install MetaMask or similar wallet.');
      }
      
      // Request account access
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      const walletAddress = accounts[0];
      
      // Generate nonce for signing
      const nonceResponse = await apiService.generateNonce(walletAddress);
      
      if (!nonceResponse.success) {
        throw new Error(nonceResponse.error || 'Failed to generate nonce');
      }
      
      const nonce = nonceResponse.nonce;
      setWalletAddress(walletAddress);
      setNonce(nonce);
      
      // Request signature
      const message = `Sign this message to authenticate with StationThis\nNonce: ${nonce}`;
      const signature = await window.ethereum.request({
        method: 'personal_sign',
        params: [message, walletAddress]
      });
      
      // Validate wallet
      const response = await apiService.validateWallet({
        walletAddress,
        signature,
        nonce
      });
      
      if (!response.success) {
        throw new Error(response.error || 'Failed to authenticate wallet');
      }
      
      onLogin({
        method: 'wallet',
        walletAddress,
        apiKey: response.session.apiKey,
        session: response.session
      });
    } catch (error) {
      console.error('Wallet connection error:', error);
      setError(error.message || 'Failed to connect wallet');
    } finally {
      setIsLoading(false);
    }
  };
  
  // Handle guest login
  const handleGuestLogin = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await apiService.createGuestSession();
      
      if (!response.success) {
        throw new Error(response.error || 'Failed to create guest session');
      }
      
      onLogin({
        method: 'guest',
        apiKey: response.session.apiKey,
        session: response.session
      });
    } catch (error) {
      setError(error.message || 'Failed to create guest session');
    } finally {
      setIsLoading(false);
    }
  };
  
  return (
    <Modal show={show} onHide={onCancel} centered backdrop="static">
      <Modal.Header closeButton>
        <Modal.Title>Welcome to StationThis</Modal.Title>
      </Modal.Header>
      
      <Modal.Body>
        {error && (
          <Alert variant="danger" className="mb-3">
            {error}
          </Alert>
        )}
        
        <Tabs
          activeKey={activeTab}
          onSelect={(k) => setActiveTab(k)}
          className="mb-3"
        >
          <Tab eventKey="apiKey" title="API Key">
            <Form onSubmit={handleApiKeyLogin}>
              <Form.Group className="mb-3">
                <Form.Label>Enter your API Key</Form.Label>
                <Form.Control
                  type="text"
                  placeholder="Paste your API key here"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  disabled={isLoading}
                />
                <Form.Text className="text-muted">
                  Enter your existing API key to access your account
                </Form.Text>
              </Form.Group>
              
              <Button
                variant="primary"
                type="submit"
                disabled={isLoading}
                className="w-100"
              >
                {isLoading ? (
                  <Spinner animation="border" size="sm" className="me-2" />
                ) : null}
                Login with API Key
              </Button>
            </Form>
          </Tab>
          
          <Tab eventKey="wallet" title="Connect Wallet">
            <div className="text-center mb-4">
              <p>Connect your Web3 wallet to access your account</p>
              <Button
                variant="outline-primary"
                onClick={handleWalletConnect}
                disabled={isLoading}
                className="w-100"
              >
                {isLoading ? (
                  <Spinner animation="border" size="sm" className="me-2" />
                ) : null}
                Connect Wallet
              </Button>
              <Form.Text className="text-muted mt-2">
                We'll create an API key for you when you connect your wallet
              </Form.Text>
            </div>
          </Tab>
          
          <Tab eventKey="guest" title="Guest Access">
            <div className="text-center mb-4">
              <p>Try out StationThis without an account</p>
              <p className="text-muted small">
                Limited features are available in guest mode
              </p>
              <Button
                variant="success"
                onClick={handleGuestLogin}
                disabled={isLoading}
                className="w-100"
              >
                {isLoading ? (
                  <Spinner animation="border" size="sm" className="me-2" />
                ) : null}
                Continue as Guest
              </Button>
            </div>
          </Tab>
        </Tabs>
      </Modal.Body>
      
      <Modal.Footer>
        <div className="w-100 text-center">
          <p className="mb-0 text-muted small">
            By continuing, you agree to our Terms of Service and Privacy Policy
          </p>
        </div>
      </Modal.Footer>
    </Modal>
  );
};

export default LoginModal; 