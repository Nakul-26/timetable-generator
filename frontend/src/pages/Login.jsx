import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import API from '../api/axios';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
import '../styles/Login.css';

const Login = () => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [showPassword, setShowPassword] = useState(false); // New state for password visibility
    const navigate = useNavigate();
    const { login } = useAuth();
    const queryClient = useQueryClient();

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            const response = await API.post('/login', { email, password });
            if (response.data.success) {
                login(response.data.user);
                queryClient.invalidateQueries();
                navigate('/');
            } else {
                setError(response.data.message);
            }
        } catch {
            setError('An error occurred. Please try again later.');
        }
    };

    return (
        <div className="login-container">
            <div className="login-form-container">
                <form className="login-form" onSubmit={handleSubmit}>
                    <h2>Login</h2>
                    {error && <p className="login-error-message">{error}</p>}
                    <div className="form-group">
                        <label htmlFor="email">Email</label>
                        <input
                            id="email"
                            type="email"
                            placeholder="Enter your email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                        />
                    </div>
                    <div className="form-group">
                        <label htmlFor="password">Password</label>
                        <div className="password-input-container"> {/* Added container for input and button */}
                            <input
                                id="password"
                                type={showPassword ? 'text' : 'password'} // Dynamic type
                                placeholder="Enter your password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                            />
                            <button
                                type="button"
                                className="toggle-password-visibility"
                                onClick={() => setShowPassword((prev) => !prev)}
                            >
                                {showPassword ? 'Hide' : 'Show'}
                            </button>
                        </div>
                    </div>
                    <button className="login-btn" type="submit">
                        Sign In
                    </button>
                </form>
            </div>
        </div>
    );
};

export default Login;
