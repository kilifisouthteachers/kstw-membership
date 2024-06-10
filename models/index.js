document.getElementById('registerForm').addEventListener('submit', async (event) => {
    event.preventDefault();

    const formData = new FormData(event.target);
    const data = Object.fromEntries(formData.entries());

    try {
        const response = await fetch('/register', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });

        const result = await response.json();

        if (response.ok) {
            
            window.location.href = result.redirectUrl;
        } else {
            console.error('Registration failed:', result.message);
            alert(result.message);
        }
    } catch (error) {
        console.error('Error during registration:', error);
        alert('An error occurred during registration.');
    }
});
