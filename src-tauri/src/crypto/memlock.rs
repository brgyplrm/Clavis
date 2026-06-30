use zeroize::Zeroize;

#[cfg(unix)]
extern "C" {
    fn mlock(addr: *const std::ffi::c_void, len: usize) -> std::ffi::c_int;
    fn munlock(addr: *const std::ffi::c_void, len: usize) -> std::ffi::c_int;
}

#[cfg(target_os = "windows")]
extern "system" {
    fn VirtualLock(lpAddress: *mut std::ffi::c_void, dwSize: usize) -> std::ffi::c_int;
    fn VirtualUnlock(lpAddress: *mut std::ffi::c_void, dwSize: usize) -> std::ffi::c_int;
}

/// A heap-allocated vector wrapper that pins its memory using OS APIs (mlock on Unix, VirtualLock on Windows)
/// to prevent sensitive encryption keys and plaintexts from moving to swap space.
///
/// It automatically unlocks and zeroizes the memory when dropped.
pub struct LockedVec {
    data: Vec<u8>,
}

impl LockedVec {
    /// Creates a new `LockedVec` and locks its contents in memory.
    pub fn new(data: Vec<u8>) -> Self {
        if !data.is_empty() {
            let ptr = data.as_ptr() as *const std::ffi::c_void;
            let len = data.len();
            unsafe {
                #[cfg(unix)]
                {
                    if mlock(ptr, len) != 0 {
                        eprintln!("Warning: mlock failed to lock sensitive memory.");
                    }
                }
                #[cfg(target_os = "windows")]
                {
                    if VirtualLock(ptr as *mut std::ffi::c_void, len) == 0 {
                        eprintln!("Warning: VirtualLock failed to lock sensitive memory.");
                    }
                }
            }
        }
        Self { data }
    }

    /// Exposes a read-only slice of the locked data.
    pub fn as_slice(&self) -> &[u8] {
        &self.data
    }

    /// Consumes the wrapper and returns the inner Vec<u8> (useful for transferring ownership).
    /// Note: This unlocks the memory but DOES NOT zeroize it immediately (it will rely on the caller).
    pub fn into_inner(mut self) -> Vec<u8> {
        if !self.data.is_empty() {
            let ptr = self.data.as_ptr() as *const std::ffi::c_void;
            let len = self.data.len();
            unsafe {
                #[cfg(unix)]
                {
                    let _ = munlock(ptr, len);
                }
                #[cfg(target_os = "windows")]
                {
                    let _ = VirtualUnlock(ptr as *mut std::ffi::c_void, len);
                }
            }
        }
        let inner = std::mem::take(&mut self.data);
        std::mem::forget(self); // Prevent drop() from running on empty data
        inner
    }
}

impl Drop for LockedVec {
    fn drop(&mut self) {
        if !self.data.is_empty() {
            let ptr = self.data.as_ptr() as *const std::ffi::c_void;
            let len = self.data.len();
            unsafe {
                #[cfg(unix)]
                {
                    let _ = munlock(ptr, len);
                }
                #[cfg(target_os = "windows")]
                {
                    let _ = VirtualUnlock(ptr as *mut std::ffi::c_void, len);
                }
            }
            self.data.zeroize();
        }
    }
}
